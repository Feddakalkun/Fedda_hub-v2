$ErrorActionPreference = "Stop"
$ScriptPath = $PSScriptRoot
$RootPath = Split-Path -Parent $ScriptPath
Set-Location $RootPath

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "      COMFYFRONT UPDATE & REPAIR UTILITY" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

# ============================================================================
# PATHS
# ============================================================================
$PyExe = Join-Path $RootPath "python_embeded\python.exe"
$GitExe = Join-Path $RootPath "git_embeded\cmd\git.exe"
$ComfyDir = Join-Path $RootPath "ComfyUI"
$CustomNodesDir = Join-Path $ComfyDir "custom_nodes"

# Use embedded git if available, otherwise system git
if (Test-Path $GitExe) {
    $env:PATH = "$(Split-Path $GitExe);$env:PATH"
} else {
    $GitExe = "git"
}

# Fix "dubious ownership" errors (install runs as Admin, update runs as user)
& $GitExe config --global --add safe.directory '*' 2>$null

# ============================================================================
# PRE-FLIGHT CHECK
# ============================================================================
if (-not (Test-Path $PyExe)) {
    Write-Host "`n[ERROR] Embedded Python not found!" -ForegroundColor Red
    Write-Host "File missing: $PyExe" -ForegroundColor Gray
    Write-Host "Please run 'install.bat' first before updating." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $ComfyDir)) {
    Write-Host "`n[ERROR] ComfyUI directory not found!" -ForegroundColor Red
    Write-Host "Please run 'install.bat' first." -ForegroundColor Yellow
    exit 1
}

# ============================================================================
# 1. CUSTOM NODES - Install missing / Update existing (from nodes.json)
# ============================================================================
Write-Host "`n[1/3] Syncing custom nodes from config/nodes.json..." -ForegroundColor Yellow

$NodesConfigFile = Join-Path $RootPath "config\nodes.json"
if (-not (Test-Path $NodesConfigFile)) {
    Write-Host "  [ERROR] config/nodes.json not found!" -ForegroundColor Red
    exit 1
}

$NodesConfig = Get-Content $NodesConfigFile -Raw | ConvertFrom-Json

if (-not (Test-Path $CustomNodesDir)) {
    New-Item -ItemType Directory -Path $CustomNodesDir -Force | Out-Null
}

$InstalledCount = 0
$UpdatedCount = 0
$FailedCount = 0

foreach ($Node in $NodesConfig) {
    # Skip local-only nodes
    if ($Node.local -eq $true) {
        Write-Host "  [$($Node.name)] Local node - skipped" -ForegroundColor Gray
        continue
    }

    $NodeDir_Install = Join-Path $CustomNodesDir $Node.folder

    if (-not (Test-Path $NodeDir_Install)) {
        # Clone missing node
        Write-Host "  [$($Node.name)] Installing..." -ForegroundColor White
        try {
            & $GitExe clone --depth 1 $Node.url "$NodeDir_Install" 2>&1
            if ($LASTEXITCODE -eq 0) {
                $InstalledCount++
                Write-Host "  [$($Node.name)] Installed OK" -ForegroundColor Green

                # Install requirements if present
                $ReqFile = Join-Path $NodeDir_Install "requirements.txt"
                if (Test-Path $ReqFile) {
                    Write-Host "  [$($Node.name)] Installing dependencies..." -ForegroundColor Gray
                    & $PyExe -m pip install -r "$ReqFile" --no-warn-script-location 2>&1 | Out-Null
                }
            } else {
                Write-Host "  [$($Node.name)] Clone failed!" -ForegroundColor Red
                $FailedCount++
            }
        }
        catch {
            Write-Host "  [$($Node.name)] Error: $_" -ForegroundColor Red
            $FailedCount++
        }
    }
    else {
        # Update existing node
        Write-Host "  [$($Node.name)] Updating..." -ForegroundColor Gray
        try {
            Set-Location $NodeDir_Install
            & $GitExe pull 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  [$($Node.name)] Git pull failed (non-fatal)" -ForegroundColor Yellow
            }
            $UpdatedCount++
            Set-Location $RootPath
        }
        catch {
            Write-Host "  [$($Node.name)] Update failed (non-fatal): $_" -ForegroundColor Yellow
            Set-Location $RootPath
        }

        # Re-check requirements in case they changed (outside try/catch so pip warnings don't look like failures)
        $ReqFile = Join-Path $NodeDir_Install "requirements.txt"
        if (Test-Path $ReqFile) {
            & $PyExe -m pip install -r "$ReqFile" --no-warn-script-location 2>&1 | Out-Null
        }
    }
}

Write-Host "`n  Summary: $InstalledCount installed, $UpdatedCount updated, $FailedCount failed" -ForegroundColor Cyan

# ============================================================================
# 2. FRONTEND - npm install
# ============================================================================
Write-Host "`n[2/3] Updating frontend dependencies..." -ForegroundColor Yellow
$FrontendDir = Join-Path $RootPath "frontend"

if (Test-Path $FrontendDir) {
    $NodeExeDir = Join-Path $RootPath "node_embeded"

    # Ensure npm shims exist
    if (Test-Path $NodeExeDir) {
        $NpmShim = Join-Path $NodeExeDir "node_modules\npm\bin\npm.cmd"
        $NpxShim = Join-Path $NodeExeDir "node_modules\npm\bin\npx.cmd"
        if (Test-Path $NpmShim) { Copy-Item $NpmShim $NodeExeDir -Force }
        if (Test-Path $NpxShim) { Copy-Item $NpxShim $NodeExeDir -Force }
    }

    Set-Location $FrontendDir
    $NpmCmd = Join-Path $NodeExeDir "npm.cmd"
    if (Test-Path $NpmCmd) {
        & "$NpmCmd" "install" 2>&1 | Out-Null
        Write-Host "  Frontend dependencies updated." -ForegroundColor Green
    }
    else {
        $NodeExe = Join-Path $NodeExeDir "node.exe"
        $NpmCli = Join-Path $NodeExeDir "node_modules\npm\bin\npm-cli.js"
        if (Test-Path $NpmCli) {
            & "$NodeExe" "$NpmCli" "install" 2>&1 | Out-Null
            Write-Host "  Frontend dependencies updated." -ForegroundColor Green
        }
        else {
            Write-Host "  [WARNING] npm not found - run install.bat first" -ForegroundColor Yellow
        }
    }
    Set-Location $RootPath
}

# ============================================================================
# 3. CLEANUP - Remove legacy files and folders from older versions
# ============================================================================
Write-Host "`n[3/3] Cleaning up legacy files..." -ForegroundColor Yellow

$LegacyFiles = @(
    "check_vibevoice_files.py",
    "cleanup_vibevoice.py",
    "create_reference_audio.py",
    "debug-comfyui.bat",
    "debug_streamer.py",
    "debug_vibevoice.py",
    "fix_vibevoice_deps.bat",
    "fix_gpu.bat",
    "download_premium_loras.bat",
    "reinstall_vibevoice_deps.bat",
    "repair_environment.bat",
    "setup_tts_audio.py",
    "test_load_model.py",
    "update_dependencies.bat",
    "VOICE_FEATURES_README.md",
    "requirements-lock.txt",
    "LOG.md"
)

$LegacyFolders = @(
    "assets\loading-screen",
    "assets\workflows",
    "ComfyUI\custom_nodes\ComfyUI_Searge_LLM",
    "ComfyUI\custom_nodes\SeargeSDXL",
    "ComfyUI\custom_nodes\ComfyUI-Custom-Nodes",
    "ComfyUI\custom_nodes\ComfyUI-Workspace-Manager",
    "ComfyUI\custom_nodes\ComfyUI-AutoConnect",
    "ComfyUI\custom_nodes\ComfyUI-Auto-Nodes-Layout",
    "ComfyUI\custom_nodes\ComfyUI-Align",
    "ComfyUI\custom_nodes\ComfyUI-Dev-Utils",
    "ComfyUI\custom_nodes\ComfyUI-FlowBuilder-Nodes",
    "ComfyUI\custom_nodes\ComfyUI-Aspire",
    "ComfyUI\custom_nodes\ComfyUI-AnimateDiff-Evolved",
    "ComfyUI\custom_nodes\ComfyMath",
    "ComfyUI\custom_nodes\mikey_nodes",
    "ComfyUI\custom_nodes\joycaption_comfyui",
    "ComfyUI\custom_nodes\ComfyUI-Image-Selector",
    "ComfyUI\custom_nodes\masquerade-nodes-comfyui",
    "ComfyUI\custom_nodes\ComfyUI_Comfyroll_CustomNodes",
    "ComfyUI\custom_nodes\chibi",
    "ComfyUI\custom_nodes\comfy-image-saver",
    "ComfyUI\custom_nodes\ComfyUI-Timer-Nodes",
    "ComfyUI\custom_nodes\comfyui-various",
    "ComfyUI\custom_nodes\was-node-suite-comfyui",
    "ComfyUI\custom_nodes\ComfyUI-Image-Saver",
    "ComfyUI\custom_nodes\ComfyUI-VoxCPM",
    "ComfyUI\custom_nodes\ComfyUI_Fill-Nodes",
    "ComfyUI\custom_nodes\Derfuu_ComfyUI_ModdedNodes",
    "ComfyUI\custom_nodes\Bjornulf_custom_nodes"
)

$CleanedCount = 0
foreach ($file in $LegacyFiles) {
    $path = Join-Path $RootPath $file
    if (Test-Path $path) {
        Remove-Item -Path $path -Force -ErrorAction SilentlyContinue
        Write-Host "  Removed: $file" -ForegroundColor Gray
        $CleanedCount++
    }
}

foreach ($folder in $LegacyFolders) {
    $path = Join-Path $RootPath $folder
    if (Test-Path $path) {
        Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  Removed folder: $folder" -ForegroundColor Gray
        $CleanedCount++
    }
}

if ($CleanedCount -eq 0) {
    Write-Host "  Nothing to clean up - already current." -ForegroundColor Green
}

# ============================================================================
# DONE
# ============================================================================
Write-Host "`n===================================================" -ForegroundColor Green
Write-Host "   UPDATE COMPLETE - READY TO GENERATE!" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Green
Write-Host "You can now close this window and run run.bat"
