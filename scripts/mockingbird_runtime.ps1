Set-StrictMode -Version Latest

function Write-MockingbirdLog {
    param(
        [string]$Message,
        [string]$Level = "Info"
    )

    $Prefix = "[Mockingbird]"
    if ($Level -eq "Warn") { $Prefix = "[Mockingbird][WARN]" }
    elseif ($Level -eq "Error") { $Prefix = "[Mockingbird][ERROR]" }

    $Formatted = "$Prefix $Message"
    if (Get-Command Write-Step -ErrorAction SilentlyContinue) {
        $Color = if ($Level -eq "Error") { "Red" } elseif ($Level -eq "Warn") { "Yellow" } else { "Green" }
        Write-Step $Formatted $Color
    } elseif (Get-Command Write-Log -ErrorAction SilentlyContinue) {
        Write-Log $Formatted
    } else {
        Write-Host $Formatted
    }
}

function Read-MockingbirdManifest {
    param([string]$RootPath)
    $ManifestPath = Join-Path $RootPath "scripts\artifacts\mockingbird.manifest.json"
    if (-not (Test-Path $ManifestPath)) {
        throw "Mockingbird manifest missing: $ManifestPath"
    }
    return (Get-Content $ManifestPath -Raw | ConvertFrom-Json)
}

function Get-MockingbirdArtifact {
    param(
        [object]$Manifest,
        [string]$Id
    )
    foreach ($Artifact in $Manifest.artifacts) {
        if ($Artifact.id -eq $Id) { return $Artifact }
    }
    throw "Mockingbird artifact '$Id' is not defined in the manifest."
}

function Remove-MockingbirdPathSafe {
    param([string]$PathToRemove)
    if (Test-Path $PathToRemove) {
        Remove-Item -LiteralPath $PathToRemove -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Test-MockingbirdDownloadedArtifact {
    param(
        [string]$Path,
        [object]$Artifact
    )

    if (-not (Test-Path $Path)) { return $false }
    $Item = Get-Item $Path -ErrorAction SilentlyContinue
    if (-not $Item -or $Item.Length -lt [int64]$Artifact.minBytes) { return $false }

    $Hash = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($Hash -ne $Artifact.sha256.ToUpperInvariant()) { return $false }

    if ($Artifact.type -eq "zip") {
        try {
            Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
            $Zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
            try {
                if ($Artifact.PSObject.Properties.Name -contains "sanityPath") {
                    $ExpectedSuffix = ($Artifact.sanityPath -replace '\\','/').ToLowerInvariant()
                    $Found = $false
                    foreach ($Entry in $Zip.Entries) {
                        if ($Entry.FullName.ToLowerInvariant().EndsWith($ExpectedSuffix)) {
                            $Found = $true
                            break
                        }
                    }
                    if (-not $Found) { return $false }
                }
            } finally {
                $Zip.Dispose()
            }
        } catch {
            return $false
        }
    } elseif ($Artifact.type -eq "pyz") {
        try {
            $Header = Get-Content -Path $Path -TotalCount 1 -ErrorAction Stop
            if ($Artifact.PSObject.Properties.Name -contains "sanitySignature") {
                if ($Header -notlike "$($Artifact.sanitySignature)*") { return $false }
            }
        } catch {
            return $false
        }
    }

    return $true
}

function Get-MockingbirdArtifactPath {
    param(
        [string]$DownloadsDir,
        [object]$Artifact
    )
    return (Join-Path $DownloadsDir $Artifact.fileName)
}

function Invoke-MockingbirdDownload {
    param(
        [string]$Url,
        [string]$DestPath
    )
    & curl.exe -L -o "$DestPath" "$Url" --retry 3 --retry-delay 2 --progress-bar
    if ($LASTEXITCODE -ne 0) {
        throw "download failure: curl exited with code $LASTEXITCODE for $Url"
    }
}

function Ensure-MockingbirdArtifact {
    param(
        [string]$DownloadsDir,
        [object]$Artifact
    )

    if (-not (Test-Path $DownloadsDir)) {
        New-Item -ItemType Directory -Path $DownloadsDir -Force | Out-Null
    }

    $ArtifactPath = Get-MockingbirdArtifactPath -DownloadsDir $DownloadsDir -Artifact $Artifact
    if (Test-MockingbirdDownloadedArtifact -Path $ArtifactPath -Artifact $Artifact) {
        Write-MockingbirdLog "Artifact valid: $($Artifact.fileName)"
        return $ArtifactPath
    }

    if (Test-Path $ArtifactPath) {
        Write-MockingbirdLog "Artifact invalid or stale, re-downloading: $($Artifact.fileName)" "Warn"
        Remove-MockingbirdPathSafe $ArtifactPath
    } else {
        Write-MockingbirdLog "Downloading artifact: $($Artifact.fileName)" "Warn"
    }

    Invoke-MockingbirdDownload -Url $Artifact.url -DestPath $ArtifactPath

    if (-not (Test-MockingbirdDownloadedArtifact -Path $ArtifactPath -Artifact $Artifact)) {
        $FirstLine = ""
        try { $FirstLine = (Get-Content -Path $ArtifactPath -TotalCount 1 -ErrorAction Stop) } catch {}
        Remove-MockingbirdPathSafe $ArtifactPath
        if ($FirstLine -match '^\s*<html') {
            throw "wrong content type / unexpected HTML while downloading $($Artifact.fileName)"
        }
        throw "checksum mismatch or invalid artifact content for $($Artifact.fileName)"
    }

    return $ArtifactPath
}

function Expand-MockingbirdZip {
    param(
        [string]$ZipFile,
        [string]$DestDir
    )

    Remove-MockingbirdPathSafe $DestDir
    New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
    try {
        Expand-Archive -Path $ZipFile -DestinationPath $DestDir -Force
    } catch {
        try {
            Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
            [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipFile, $DestDir)
        } catch {
            throw "extraction failure for $(Split-Path $ZipFile -Leaf): $($_.Exception.Message)"
        }
    }
}

function Enable-MockingbirdEmbedSitePackages {
    param([string]$PythonRoot)
    $PthPath = Join-Path $PythonRoot "python310._pth"
    if (-not (Test-Path $PthPath)) { return }
    $Updated = $false
    $Lines = Get-Content $PthPath | ForEach-Object {
        if ($_ -match '^\s*#\s*import site\s*$') {
            $Updated = $true
            'import site'
        } else {
            $_
        }
    }
    if ($Updated) {
        Set-Content -Path $PthPath -Value $Lines
    }
}

function Test-MockingbirdPythonUsable {
    param([string]$PythonExe)
    if (-not (Test-Path $PythonExe)) { return $false }
    $Proc = Start-Process -FilePath $PythonExe -ArgumentList "-c `"import sys; print(sys.version)`"" -NoNewWindow -Wait -PassThru
    return ($Proc.ExitCode -eq 0)
}

function Test-MockingbirdPythonFullRuntime {
    param([string]$PythonRoot)
    $PythonExe = Join-Path $PythonRoot "python.exe"
    $Header = Join-Path $PythonRoot "include\Python.h"
    $Lib = Join-Path $PythonRoot "libs\python310.lib"
    if (-not (Test-MockingbirdPythonUsable -PythonExe $PythonExe)) { return $false }
    return (Test-Path $Header) -and (Test-Path $Lib)
}

function Test-MockingbirdVenvPip {
    param([string]$VenvPy)
    if (-not (Test-Path $VenvPy)) { return $false }
    $Proc = Start-Process -FilePath $VenvPy -ArgumentList "-m pip --version" -NoNewWindow -Wait -PassThru
    return ($Proc.ExitCode -eq 0)
}

function Test-MockingbirdRepoUsable {
    param([string]$RepoDir)
    $MainFile = Join-Path $RepoDir "xtts_api_server\__main__.py"
    $ReqFile = Join-Path $RepoDir "requirements.txt"
    return (Test-Path $MainFile) -and (Test-Path $ReqFile)
}

function Test-MockingbirdRuntimeReady {
    param([string]$RootPath)

    $MockDir = Join-Path $RootPath "mockingbird_tts"
    $PythonExe = Join-Path $MockDir "python310\python.exe"
    $VenvPy = Join-Path $MockDir "venv\Scripts\python.exe"
    $RepoDir = Join-Path $MockDir "xtts-api-server"

    if (-not (Test-MockingbirdPythonUsable -PythonExe $PythonExe)) { return $false }
    if (-not (Test-MockingbirdVenvPip -VenvPy $VenvPy)) { return $false }
    if (-not (Test-MockingbirdRepoUsable -RepoDir $RepoDir)) { return $false }

    $Health = Start-Process -FilePath $VenvPy -ArgumentList "-c `"import sys; sys.path.insert(0, r'$RepoDir'); import xtts_api_server; print('ok')`"" -NoNewWindow -Wait -PassThru
    return ($Health.ExitCode -eq 0)
}

function Ensure-MockingbirdPython {
    param(
        [string]$MockDir,
        [string]$DownloadsDir,
        [object]$Manifest
    )

    $PythonRoot = Join-Path $MockDir "python310"
    $PythonExe = Join-Path $PythonRoot "python.exe"
    $PythonArtifact = Get-MockingbirdArtifact -Manifest $Manifest -Id "python_embed_3_10_11"

    if (Test-MockingbirdPythonFullRuntime -PythonRoot $PythonRoot) {
        Write-MockingbirdLog "Dedicated Python already installed."
        Enable-MockingbirdEmbedSitePackages -PythonRoot $PythonRoot
        return $PythonExe
    }

    Write-MockingbirdLog "Repairing dedicated Python runtime with full dev headers..." "Warn"
    $ZipPath = Ensure-MockingbirdArtifact -DownloadsDir $DownloadsDir -Artifact $PythonArtifact
    $ExtractDir = Join-Path $MockDir "python310_extract"
    Expand-MockingbirdZip -ZipFile $ZipPath -DestDir $ExtractDir
    $ExpandedRoot = if (Test-Path (Join-Path $ExtractDir "tools\python.exe")) { Join-Path $ExtractDir "tools" } else { $ExtractDir }
    Remove-MockingbirdPathSafe (Join-Path $MockDir "venv")
    Remove-MockingbirdPathSafe $PythonRoot
    New-Item -ItemType Directory -Path $PythonRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $ExpandedRoot -Force | ForEach-Object {
        Move-Item -LiteralPath $_.FullName -Destination $PythonRoot -Force
    }
    Remove-MockingbirdPathSafe $ExtractDir
    Enable-MockingbirdEmbedSitePackages -PythonRoot $PythonRoot
    if (-not (Test-MockingbirdPythonFullRuntime -PythonRoot $PythonRoot)) {
        throw "health-check failure: dedicated Mockingbird Python is not runnable"
    }
    return $PythonExe
}

function Ensure-MockingbirdVenv {
    param(
        [string]$MockDir,
        [string]$DownloadsDir,
        [object]$Manifest
    )

    $PythonExe = Join-Path $MockDir "python310\python.exe"
    $VenvDir = Join-Path $MockDir "venv"
    $VenvPy = Join-Path $VenvDir "Scripts\python.exe"

    if (Test-MockingbirdVenvPip -VenvPy $VenvPy) {
        Write-MockingbirdLog "Virtual environment already healthy."
        return $VenvPy
    }

    Write-MockingbirdLog "Creating or repairing Mockingbird virtual environment..." "Warn"
    Remove-MockingbirdPathSafe $VenvDir
    $CreateProc = Start-Process -FilePath $PythonExe -ArgumentList "-m venv `"$VenvDir`"" -NoNewWindow -Wait -PassThru
    if ($CreateProc.ExitCode -ne 0 -or -not (Test-MockingbirdVenvPip -VenvPy $VenvPy)) {
        throw "venv failure: could not create a healthy Mockingbird virtual environment"
    }
    return $VenvPy
}

function Ensure-MockingbirdRepo {
    param(
        [string]$MockDir,
        [string]$DownloadsDir,
        [object]$Manifest
    )

    $RepoDir = Join-Path $MockDir "xtts-api-server"
    $RepoArtifact = Get-MockingbirdArtifact -Manifest $Manifest -Id "xtts_api_server_repo"
    if (Test-MockingbirdRepoUsable -RepoDir $RepoDir) {
        Write-MockingbirdLog "xtts-api-server runtime already present."
        return $RepoDir
    }

    Write-MockingbirdLog "Repairing xtts-api-server runtime..." "Warn"
    $ZipPath = Ensure-MockingbirdArtifact -DownloadsDir $DownloadsDir -Artifact $RepoArtifact
    $ExtractRoot = Join-Path $MockDir "xtts-api-server_extract"
    Expand-MockingbirdZip -ZipFile $ZipPath -DestDir $ExtractRoot
    $ExpandedDir = Join-Path $ExtractRoot $RepoArtifact.extractRoot
    if (-not (Test-MockingbirdRepoUsable -RepoDir $ExpandedDir)) {
        Remove-MockingbirdPathSafe $ExtractRoot
        throw "extraction failure: xtts-api-server archive does not contain expected files"
    }
    Remove-MockingbirdPathSafe $RepoDir
    Move-Item -LiteralPath $ExpandedDir -Destination $RepoDir -Force
    Remove-MockingbirdPathSafe $ExtractRoot
    return $RepoDir
}

function Install-MockingbirdPythonPackages {
    param(
        [string]$MockDir,
        [string]$RepoDir,
        [string]$VenvPy
    )

    $env:PIP_CACHE_DIR = Join-Path (Split-Path $MockDir -Parent) "cache\pip"
    $PipUpgrade = Start-Process -FilePath $VenvPy -ArgumentList "-m pip install --upgrade pip wheel setuptools --no-warn-script-location" -NoNewWindow -Wait -PassThru
    if ($PipUpgrade.ExitCode -ne 0) {
        throw "pip bootstrap failure: could not upgrade pip tooling for Mockingbird"
    }

    $ReqProc = Start-Process -FilePath $VenvPy -ArgumentList "-m pip install -r `"$RepoDir\requirements.txt`" --no-warn-script-location" -NoNewWindow -Wait -PassThru
    if ($ReqProc.ExitCode -ne 0) {
        throw "xtts dependency failure: could not install xtts-api-server requirements"
    }

    $TorchProc = Start-Process -FilePath $VenvPy -ArgumentList "-m pip install torch==2.1.1+cu118 torchaudio==2.1.1+cu118 --index-url https://download.pytorch.org/whl/cu118 --no-warn-script-location" -NoNewWindow -Wait -PassThru
    if ($TorchProc.ExitCode -ne 0) {
        throw "xtts dependency failure: could not install Mockingbird torch packages"
    }
}

function Ensure-MockingbirdSpeaker {
    param(
        [string]$MockDir,
        [string]$SpeakerSource
    )
    $SpeakersDir = Join-Path $MockDir "speakers"
    if (-not (Test-Path $SpeakersDir)) {
        New-Item -ItemType Directory -Path $SpeakersDir -Force | Out-Null
    }
    if (Test-Path $SpeakerSource) {
        Copy-Item -Path $SpeakerSource -Destination (Join-Path $SpeakersDir "charlotte.wav") -Force
        Write-MockingbirdLog "Default speaker installed."
    } else {
        Write-MockingbirdLog "Speaker source missing: $SpeakerSource" "Warn"
    }
}

function Install-MockingbirdRuntimeShared {
    param(
        [string]$RootPath,
        [string]$SpeakerSource
    )

    $Manifest = Read-MockingbirdManifest -RootPath $RootPath
    $MockDir = Join-Path $RootPath "mockingbird_tts"
    $DownloadsDir = Join-Path $MockDir "downloads"
    $OutputDir = Join-Path $MockDir "output"
    $ModelsDir = Join-Path $MockDir "xtts_models"
    $CacheDir = Join-Path $MockDir "cache"
    foreach ($Dir in @($MockDir, $DownloadsDir, $OutputDir, $ModelsDir, $CacheDir)) {
        if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
    }

    $PythonExe = Ensure-MockingbirdPython -MockDir $MockDir -DownloadsDir $DownloadsDir -Manifest $Manifest
    $VenvPy = Ensure-MockingbirdVenv -MockDir $MockDir -DownloadsDir $DownloadsDir -Manifest $Manifest
    $RepoDir = Ensure-MockingbirdRepo -MockDir $MockDir -DownloadsDir $DownloadsDir -Manifest $Manifest
    Install-MockingbirdPythonPackages -MockDir $MockDir -RepoDir $RepoDir -VenvPy $VenvPy
    Ensure-MockingbirdSpeaker -MockDir $MockDir -SpeakerSource $SpeakerSource

    if (-not (Test-MockingbirdRuntimeReady -RootPath $RootPath)) {
        throw "health-check failure: Mockingbird runtime did not pass validation after install"
    }

    Write-MockingbirdLog "XTTS runtime ready."
}
