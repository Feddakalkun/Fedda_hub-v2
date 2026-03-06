# ============================================================================ 
# FEDDAKALKUN ComfyUI - Ultimate Portable Installer
# ============================================================================ 

$ErrorActionPreference = "Stop"
$ScriptPath = $PSScriptRoot
$RootPath = Split-Path -Parent $ScriptPath
$RootPath = (Resolve-Path $RootPath).Path  # Ensure absolute path
Set-Location $RootPath

# Toggle to pause after each major step for review
$PauseEachStep = $false

Write-Host "Installation root: $RootPath"


# Always create logs directory at the root (not inside custom_nodes)
$LogsDir = Join-Path $RootPath "logs"
if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir | Out-Null }
$LogFile = Join-Path $LogsDir "install_log.txt"

# Start full transcript — captures ALL console output (pip, git, etc.)
$TranscriptFile = Join-Path $LogsDir "install_full_log.txt"
try { Stop-Transcript -ErrorAction SilentlyContinue } catch {}
Start-Transcript -Path $TranscriptFile -Force

function Write-Log {
    param([string]$Message)
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $LogEntry = "[$Timestamp] $Message"
    Write-Host $Message
    
    # Add mutex to prevent concurrent write errors
    $MaxRetries = 5
    $RetryCount = 0
    while ($RetryCount -lt $MaxRetries) {
        try {
            Add-Content -Path $LogFile -Value $LogEntry -ErrorAction Stop
            break
        }
        catch {
            $RetryCount++
            Start-Sleep -Milliseconds 100
            if ($RetryCount -eq $MaxRetries) {
                # Silently fail after retries to avoid breaking the install
                Write-Host "[WARNING] Could not write to log file after $MaxRetries attempts"
            }
        }
    }
}

function Download-File {
    param([string]$Url, [string]$Dest)
    if (-not (Test-Path $Dest)) {
        Write-Log "Downloading $(Split-Path $Dest -Leaf)..."
        try {
            # Use curl instead of Invoke-WebRequest (10x faster!)
            & curl.exe -L -o "$Dest" "$Url" --progress-bar --retry 3 --retry-delay 2
            if ($LASTEXITCODE -ne 0) {
                throw "curl failed with exit code $LASTEXITCODE"
            }
        }
        catch {
            Write-Log "ERROR: Failed to download $Url"
            throw $_ 
        }
    }
}

function Extract-Zip {
    param([string]$ZipFile, [string]$DestDir)
    Write-Log "Extracting $(Split-Path $ZipFile -Leaf)..."
    try {
        Expand-Archive -Path $ZipFile -DestinationPath $DestDir -Force
    }
    catch {
        Write-Log "Expand-Archive failed, using .NET fallback..."
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipFile, $DestDir)
    }
}

# Pause helper for step-by-step review
function Pause-Step {
    if ($PauseEachStep) {
        Read-Host "Step complete. Press Enter to continue"
    }
}

Write-Log "========================================="
Write-Log " FEDDAKALKUN - Portable Installation"
Write-Log "========================================="

# ============================================================================
# 0. SYSTEM CHECK (Show specs, confirm before installing)
# ============================================================================
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  FEDDAKALKUN - Ultimate Frontend" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# --- Path Safety Check ---
$UnsafePaths = @("$env:USERPROFILE\Desktop", "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Documents", "$env:USERPROFILE\OneDrive")
$IsUnsafe = $false
foreach ($BadPath in $UnsafePaths) {
    if ($RootPath.StartsWith($BadPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        $IsUnsafe = $true
        break
    }
}
# Also warn if on C: system drive in general
$IsCDrive = $RootPath.StartsWith("C:\", [System.StringComparison]::OrdinalIgnoreCase)

if ($IsUnsafe) {
    Write-Host "  WARNING: Installed in a system folder!" -ForegroundColor Red
    Write-Host "  Current path: $RootPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "  RECOMMENDATION: Move this folder to a dedicated location like:" -ForegroundColor Yellow
    Write-Host "    D:\FeddaFront\  or  E:\FeddaFront\" -ForegroundColor White
    Write-Host ""
    Write-Host "  Installing in Desktop/Downloads/Documents can cause:" -ForegroundColor Yellow
    Write-Host "    - OneDrive sync conflicts" -ForegroundColor Gray
    Write-Host "    - Antivirus false positives" -ForegroundColor Gray
    Write-Host "    - Permission issues" -ForegroundColor Gray
    Write-Host "    - Accidental deletion" -ForegroundColor Gray
    Write-Host ""
    $PathConfirm = Read-Host "  Continue anyway? (Y/N)"
    if ($PathConfirm -ne "Y" -and $PathConfirm -ne "y") {
        Write-Host "`n  Move the folder and run install.bat again." -ForegroundColor Yellow
        exit 0
    }
}
elseif ($IsCDrive) {
    Write-Host "  NOTE: Installed on C: drive. This works but a separate" -ForegroundColor Yellow
    Write-Host "        drive (D:\, E:\) is recommended to avoid filling" -ForegroundColor Yellow
    Write-Host "        your system drive (~8-15 GB total)." -ForegroundColor Yellow
    Write-Host ""
}

# --- Disclaimer ---
Write-Host "  DISCLAIMER: This software is provided as-is by FEDDAKALKUN." -ForegroundColor Gray
Write-Host "  It installs portable runtimes (Python, Node, Git) locally" -ForegroundColor Gray
Write-Host "  in this folder only. It does NOT modify your system." -ForegroundColor Gray
Write-Host ""

# Gather system info
$OSInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$CPUInfo = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
$RAM_GB = if ($OSInfo) { [math]::Round($OSInfo.TotalVisibleMemorySize / 1MB) } else { 0 }

Write-Host "  OS:       $($OSInfo.Caption) $($OSInfo.OSArchitecture)" -ForegroundColor White
Write-Host "  CPU:      $($CPUInfo.Name)" -ForegroundColor White
Write-Host "  RAM:      ${RAM_GB} GB" -ForegroundColor White

# GPU Detection
try {
    $GPUs = Get-CimInstance Win32_VideoController -ErrorAction Stop
    $NvidiaGPU = $GPUs | Where-Object { $_.Name -match "NVIDIA" } | Select-Object -First 1

    if (-not $NvidiaGPU) {
        Write-Host "  GPU:      $(($GPUs | ForEach-Object { $_.Name }) -join ', ')" -ForegroundColor Red
        Write-Host ""
        Write-Host "  STATUS:   INCOMPATIBLE" -ForegroundColor Red
        Write-Host ""
        Write-Host "  This app requires an NVIDIA GPU with CUDA support." -ForegroundColor Red
        Write-Host "  AMD and Intel GPUs are not supported." -ForegroundColor Red
        Write-Host ""
        Write-Host "  Contact FEDDAKALKUN for help: https://feddakalkun.com" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Press any key to exit..." -ForegroundColor Yellow
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 1
    }

    $GPUName = $NvidiaGPU.Name
    Write-Host "  GPU:      $GPUName" -ForegroundColor Green

    # Use nvidia-smi for accurate VRAM (Win32_VideoController overflows above 4GB)
    $VRAM_MB = 0
    try {
        $SmiOutput = & nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null
        if ($SmiOutput) {
            $VRAM_MB = [int]($SmiOutput.Trim())
        }
    } catch {}

    if ($VRAM_MB -gt 0) {
        $VRAM_GB = [math]::Round($VRAM_MB / 1024)
        Write-Host "  VRAM:     ${VRAM_GB} GB" -ForegroundColor Green
    }
    else {
        Write-Host "  VRAM:     Could not detect" -ForegroundColor White
    }
}
catch {
    Write-Host "  GPU:      Detection failed (continuing anyway)" -ForegroundColor Yellow
}

# Disk space check
$Drive = (Get-Item $RootPath).PSDrive
$FreeSpace_GB = [math]::Round($Drive.Free / 1GB)
Write-Host "  Disk:     ${FreeSpace_GB} GB free on $($Drive.Name):\" -ForegroundColor $(if ($FreeSpace_GB -ge 15) { "Green" } elseif ($FreeSpace_GB -ge 10) { "Yellow" } else { "Red" })

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan

if ($FreeSpace_GB -lt 10) {
    Write-Host "  WARNING: Low disk space! Need at least 10GB free." -ForegroundColor Red
}

Write-Host ""
Write-Host "  If something looks wrong, contact FEDDAKALKUN:" -ForegroundColor Gray
Write-Host "  https://feddakalkun.com" -ForegroundColor Cyan
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Ask user to confirm
$Confirm = Read-Host "  Does this look correct? Press ENTER to install, or type N to cancel"
if ($Confirm -eq "N" -or $Confirm -eq "n") {
    Write-Host "`n  Installation cancelled. Contact FEDDAKALKUN for help." -ForegroundColor Yellow
    exit 0
}

Write-Log "System check passed. GPU: $GPUName | RAM: ${RAM_GB}GB | Disk: ${FreeSpace_GB}GB free"

# ============================================================================
# 1. BOOTSTRAP PORTABLE TOOLS
# ============================================================================

# --- 1.1 Portable Python ---
$PyDir = Join-Path $RootPath "python_embeded"
$PyExe = Join-Path $PyDir "python.exe"

if (-not (Test-Path $PyExe)) {
    Write-Log "[ComfyUI 1/9] Setting up Portable Python..."
    $PyZip = Join-Path $RootPath "python_embed.zip"
    Download-File "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip" $PyZip
    
    New-Item -ItemType Directory -Path $PyDir -Force | Out-Null
    Extract-Zip $PyZip $PyDir
    Remove-Item $PyZip -Force

    # --- CRITICAL FIX: Configure python311._pth ---
    # 1. Enable site-packages (import site)
    # 2. Add ../ComfyUI to path so 'import comfy' works
    $PthFile = Join-Path $PyDir "python311._pth"
    $Content = Get-Content $PthFile
    $Content = $Content -replace "#import site", "import site"
    
    if ($Content -notcontains "../ComfyUI") {
        $Content += "../ComfyUI"
    }
    
    Set-Content -Path $PthFile -Value $Content
    Write-Log "Portable Python configured (Path fixed)."

    # Install Pip
    Write-Log "Installing Pip..."
    $GetPip = Join-Path $RootPath "get-pip.py"
    Download-File "https://bootstrap.pypa.io/get-pip.py" $GetPip
    Start-Process -FilePath $PyExe -ArgumentList "$GetPip" -NoNewWindow -Wait
    Remove-Item $GetPip -Force
}
else {
    Write-Log "[ComfyUI 1/9] Portable Python found."
}

Pause-Step

# --- 1.2 Portable Git (MinGit) ---
$GitDir = Join-Path $RootPath "git_embeded"
$GitExe = Join-Path $GitDir "cmd\git.exe"

if (-not (Test-Path $GitExe)) {
    Write-Log "[ComfyUI 2/9] Setting up Portable Git..."
    $GitZip = Join-Path $RootPath "mingit.zip"
    Download-File "https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/MinGit-2.43.0-64-bit.zip" $GitZip
    
    New-Item -ItemType Directory -Path $GitDir -Force | Out-Null
    Extract-Zip $GitZip $GitDir
    Remove-Item $GitZip -Force
    Write-Log "Portable Git configured."
}
else {
    Write-Log "[ComfyUI 2/9] Portable Git found."
}

Pause-Step

# --- 1.3 Portable Node.js ---
$NodeDir = Join-Path $RootPath "node_embeded"
$NodeExe = Join-Path $NodeDir "node.exe"

if (-not (Test-Path $NodeExe)) {
    Write-Log "[ComfyUI 3/9] Setting up Portable Node.js..."
    $NodeZip = Join-Path $RootPath "node.zip"
    Download-File "https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip" $NodeZip
    
    Extract-Zip $NodeZip $RootPath
    $ExtractedNode = Get-ChildItem -Path $RootPath -Directory -Filter "node-v*-win-x64" | Select-Object -First 1
    if ($ExtractedNode) {
        Rename-Item -Path $ExtractedNode.FullName -NewName "node_embeded"
        
        # Ensure npm/npx shims are in the root if they ended up elsewhere
        $NpmShim = Join-Path $NodeDir "node_modules\npm\bin\npm.cmd"
        $NpxShim = Join-Path $NodeDir "node_modules\npm\bin\npx.cmd"
        if (Test-Path $NpmShim) { Copy-Item $NpmShim $NodeDir -Force }
        if (Test-Path $NpxShim) { Copy-Item $NpxShim $NodeDir -Force }
    }
    Remove-Item $NodeZip -Force
    Write-Log "Portable Node.js configured."
}
else {
    Write-Log "[ComfyUI 3/9] Portable Node.js found."
}

Pause-Step

# Helper to run commands with portable environment
$env:PATH = "$GitDir\cmd;$NodeDir;$PyDir;$PyDir\Scripts;$env:PATH"

function Run-Pip {
    param([string]$Arguments)
    $Process = Start-Process -FilePath $PyExe -ArgumentList "-m pip $Arguments" -NoNewWindow -Wait -PassThru
    if ($Process.ExitCode -ne 0) {
        Write-Log "WARNING: Pip command failed: $Arguments"
    }
}

function Run-Git {
    param([string]$Arguments)
    $Process = Start-Process -FilePath $GitExe -ArgumentList "$Arguments" -NoNewWindow -Wait -PassThru
    return $Process.ExitCode
}

# ============================================================================ 
# 3. COMPONENT INSTALLERS
# ============================================================================ 

function Install-Frontend {
    Write-Log "`n[Frontend] Installing frontend dependencies..."
    $FrontendDir = Join-Path $RootPath "frontend"
    
    if (-not (Test-Path $FrontendDir)) {
        Write-Log "ERROR: frontend directory missing!"
        return
    }

    Set-Location $FrontendDir
    # Use portable node/npm correctly
    $NpmCmd = Join-Path $NodeDir "npm.cmd"
    if (Test-Path $NpmCmd) {
        & "$NpmCmd" "install"
    }
    else {
        # Fallback to direct JS execution if shim is missing
        $NpmCli = Join-Path $NodeDir "node_modules\npm\bin\npm-cli.js"
        & "$NodeExe" "$NpmCli" "install"
    }
    
    Set-Location $RootPath
    Write-Log "[Frontend] Setup complete."
    Pause-Step
}

function Install-Ollama {
    Write-Log "`n[Ollama] Setting up Ollama..."
    $OllamaDir = Join-Path $RootPath "ollama_embeded"
    $OllamaExe = Join-Path $OllamaDir "ollama.exe"
    
    if (-not (Test-Path $OllamaExe)) {
        New-Item -ItemType Directory -Path $OllamaDir -Force | Out-Null
        
        $OllamaZip = Join-Path $OllamaDir "ollama.zip"
        $OllamaUrl = "https://github.com/ollama/ollama/releases/download/v0.5.4/ollama-windows-amd64.zip"
        
        Write-Log "Downloading Ollama portable binary..."
        Download-File $OllamaUrl $OllamaZip
        
        Write-Log "Extracting Ollama..."
        Extract-Zip $OllamaZip $OllamaDir
        Remove-Item $OllamaZip -Force
        
        Write-Log "[Ollama] Installed successfully."
    }
    else {
        Write-Log "[Ollama] Already installed."
    }
    Pause-Step
}


# ============================================================================ 
# 2. INSTALLATION LOGIC
# ============================================================================ 

# 4. Setup ComfyUI Repository
# Pinned to tested stable commit to prevent breaking changes for users
$ComfyUICommit = "0467f69"  # 2026-02 stable: comfy aimdo 0.2.2
Write-Log "`n[ComfyUI 4/9] Setting up ComfyUI repository (pinned: $ComfyUICommit)..."
$ComfyDir = Join-Path $RootPath "ComfyUI"
if (-not (Test-Path $ComfyDir)) {
    Write-Log "Cloning ComfyUI repository (official)..."
    try {
        Run-Git "clone https://github.com/comfyanonymous/ComfyUI.git `"$ComfyDir`""
        # Checkout pinned commit for stability
        Set-Location $ComfyDir
        Run-Git "checkout $ComfyUICommit"
        Set-Location $RootPath
        Write-Log "ComfyUI cloned and pinned to $ComfyUICommit."
    }
    catch {
        Write-Log "ERROR: Failed to clone ComfyUI repository."
        exit 1
    }
}
else {
    Write-Log "ComfyUI directory already exists."
}

Pause-Step

# 5. Core Dependencies
Write-Log "`n[ComfyUI 5/9] Installing core dependencies..."
$ComfyDir = Join-Path $RootPath "ComfyUI"

Write-Log "Upgrading pip..."
Run-Pip "install --upgrade pip wheel setuptools"

Write-Log "Installing PyTorch (CUDA 12.4)..."
# CUDA 12.4 has latest PyTorch builds and supports GPUs from GTX 1060 to RTX 5090
Run-Pip "install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124"
if ($LASTEXITCODE -ne 0) {
    Write-Log "CUDA PyTorch failed, trying CPU fallback..."
    Run-Pip "install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu"
}

Write-Log "Installing Xformers..."
Run-Pip "install xformers --index-url https://download.pytorch.org/whl/cu124"

Write-Log "Installing ComfyUI requirements..."
$ReqFile = Join-Path $ComfyDir "requirements.txt"
Run-Pip "install -r $ReqFile"

Write-Log "Installing core dependencies..."
Run-Pip "install numpy scipy matplotlib pillow tqdm requests psutil"

Pause-Step

# 6. Custom Nodes Installation
Write-Log "`n[ComfyUI 6/9] Installing Custom Nodes..."
$NodesConfig = Get-Content (Join-Path $RootPath "config\nodes.json") | ConvertFrom-Json
$CustomNodesDir = Join-Path $ComfyDir "custom_nodes"

$InstalledCount = 0
$SkippedCount = 0
$FailedCount = 0

foreach ($Node in $NodesConfig) {
    # Skip local nodes (e.g., AutoModelFetcher)
    if ($Node.local -eq $true) {
        Write-Log "[$($Node.name)] - Local node, skipping git clone"
        continue
    }

    $NodeInstallDir = Join-Path $CustomNodesDir $Node.folder
    if (-not (Test-Path $NodeInstallDir)) {
        Write-Log "Installing $($Node.name)..."
        $GitResult = Run-Git "clone --depth 1 $($Node.url) `"$NodeInstallDir`""
        if ($GitResult -eq 0) {
            Write-Log "[$($Node.name)] - Installed successfully"
            $InstalledCount++

            # Install node requirements if requirements.txt exists
            $NodeReqFile = Join-Path $NodeInstallDir "requirements.txt"
            if (Test-Path $NodeReqFile) {
                Write-Log "[$($Node.name)] - Installing node requirements..."

                # Create a filtered requirements file (skip insightface - installed globally)
                $RequirementsContent = Get-Content $NodeReqFile
                $FilteredRequirements = $RequirementsContent | Where-Object { $_ -notmatch '^\s*insightface' }

                if ($FilteredRequirements.Count -lt $RequirementsContent.Count) {
                    Write-Log "[$($Node.name)] - Skipping insightface (already installed globally)"
                    $TempReqFile = Join-Path $NodeInstallDir "requirements_filtered.txt"
                    Set-Content -Path $TempReqFile -Value $FilteredRequirements
                    Run-Pip "install -r `"$TempReqFile`" --no-warn-script-location"
                    Remove-Item $TempReqFile -Force
                }
                else {
                    Run-Pip "install -r `"$NodeReqFile`" --no-warn-script-location"
                }
            }

            # Create __init__.py if missing
            $InitFile = Join-Path $NodeInstallDir "__init__.py"
            if (-not (Test-Path $InitFile)) {
                # Ensure the directory exists first
                if (-not (Test-Path $NodeInstallDir)) {
                    New-Item -ItemType Directory -Path $NodeInstallDir -Force | Out-Null
                }
                $InitContent = @"
# $($Node.folder) - Custom nodes for ComfyUI
import sys
import os
from pathlib import Path

current_dir = os.path.dirname(__file__)
if current_dir not in sys.path:
    sys.path.append(current_dir)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']
"@
                Set-Content -Path $InitFile -Value $InitContent
            }
        }
        else {
            Write-Log "[$($Node.name)] - Failed to install"
            $FailedCount++
        }
    }
    else {
        Write-Log "[$($Node.name)] - Already present"
        $SkippedCount++
    }
}

Pause-Step

# 7. Comprehensive Dependencies (Updated with fixes)
Write-Log "`n[ComfyUI 7/9] Installing comprehensive dependencies..."

# 7.1 Install Build Tools first (Fix for insightface)
Write-Log "Installing build dependencies..."
Run-Pip "install cmake ninja Cython"

# 7.1.5 Install insightface early with pre-built wheel (avoid compilation)
Write-Log "Installing insightface (pre-built wheel)..."
Run-Pip "install insightface --prefer-binary --no-build-isolation"

# 7.2 Main Dependencies
$Deps = @(
    "accelerate", "transformers", "diffusers", "safetensors",
    "huggingface-hub", "onnxruntime-gpu", "onnxruntime", "omegaconf",
    "aiohttp", "aiohttp-sse",
    "pytube", "yt-dlp", "moviepy", "youtube-transcript-api",
    "numba",
    "imageio", "imageio-ffmpeg", "av",
    "gdown", "pandas", "reportlab", "google-auth>=2.45.0", "google-auth-oauthlib", "google-auth-httplib2",
    "GPUtil", "wandb",
    "piexif", "rembg",
    "pillow-heif",
    "librosa", "soundfile",
    "webdriver-manager", "beautifulsoup4", "lxml", "shapely",
    "deepdiff", "fal_client", "matplotlib", "scipy", "scikit-image", "scikit-learn",
    "timm", "colour-science", "blend-modes", "loguru",
    "fastapi", "uvicorn[standard]", "python-multipart"
)
Run-Pip "install $($Deps -join ' ')"

# 7.3 (Removed) llama-cpp-python no longer needed - Ollama handles all LLM tasks

# 7.4 Setup Audio Assets (if script exists)
Write-Log "`n[Audio Setup] Configuring TTS assets..."
$AudioScript = Join-Path $ScriptPath "setup_tts_audio.py"
if (Test-Path $AudioScript) {
    Start-Process -FilePath $PyExe -ArgumentList "$AudioScript" -NoNewWindow -Wait
    Write-Log "Audio assets configured."
}

Pause-Step


# 8. Install Custom Assets (styles.csv only - workflows excluded in free version)
Write-Log "`n[ComfyUI 8/9] Installing Custom Assets..."

# Install styles.csv to ComfyUI root
$StylesSrc = Join-Path $RootPath "assets\styles.csv"
if (Test-Path $StylesSrc) {
    Copy-Item -Path $StylesSrc -Destination $ComfyDir -Force
    Write-Log "Installed styles.csv for Styles CSV Loader node."
}
else {
    Write-Log "styles.csv not found, skipping."
}


Pause-Step

# ============================================================================ 
# 8.5 INSTALL BUNDLED LORAS
# ============================================================================ 
Write-Log "`n[ComfyUI 8.5/9] Installing Free Bundled LoRAs..."
$TargetLoraDir = Join-Path $ComfyDir "models\loras\z-image"
if (-not (Test-Path $TargetLoraDir)) {
    New-Item -ItemType Directory -Path $TargetLoraDir -Force | Out-Null
}

$SrcLoraDir = Join-Path $RootPath "assets\loras\z-image"
if (Test-Path $SrcLoraDir) {
    Copy-Item -Path "$SrcLoraDir\*" -Destination $TargetLoraDir -Recurse -Force
    Write-Log "Bundled Z-Image LoRAs (Emmy, Zana) installed successfully."
}
else {
    Write-Log "Warning: Bundled LoRAs not found in assets. Skipping."
}

Pause-Step

# 9. Configure ComfyUI-Manager Security (Weak Mode)
Write-Log "`n[ComfyUI 9/9] Configuring ComfyUI-Manager Security..."
# FIXED: Correct path is user/__manager not user/default/ComfyUI-Manager
$ManagerConfigDir = Join-Path $ComfyDir "user\__manager"
$ManagerConfigFile = Join-Path $ManagerConfigDir "config.ini"

if (-not (Test-Path $ManagerConfigDir)) {
    New-Item -ItemType Directory -Path $ManagerConfigDir -Force | Out-Null
}

# Always overwrite to ensure security_level is set to weak
$ConfigContent = @"
[default]
preview_method = none
git_exe = 
use_uv = False
channel_url = https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main
share_option = all
bypass_ssl = False
file_logging = True
component_policy = mine
update_policy = stable-comfyui
windows_selector_event_loop_policy = False
model_download_by_agent = False
downgrade_blacklist = 
security_level = weak
always_lazy_install = False
network_mode = public
db_mode = remote
"@
Set-Content -Path $ManagerConfigFile -Value $ConfigContent
Write-Log "Security level set to 'weak' - all custom nodes can auto-install."

Pause-Step

# 9.5 Cleanup legacy ComfyUI-Manager backup (if exists)
Write-Log "`nCleaning up legacy ComfyUI-Manager data..."
$LegacyBackup = Join-Path $ComfyDir "user\__manager\.legacy-manager-backup"
if (Test-Path $LegacyBackup) {
    try {
        Remove-Item -Path $LegacyBackup -Recurse -Force -ErrorAction Stop
        Write-Log "Legacy backup removed successfully."
    }
    catch {
        Write-Log "WARNING: Could not remove legacy backup (non-fatal): $_"
    }
}
else {
    Write-Log "No legacy backup found - clean install."
}

# 10. Install Other Components
Install-Frontend
Install-Ollama

# 10.5 Install SageAttention (if GPU supports it / 40-series+)
function Install-SageAttention {
    Write-Log "`n[Optimization] Checking GPU architecture..."
    try {
        $GPUObject = Get-CimInstance Win32_VideoController -ErrorAction Stop
        $GPUName = $GPUObject.Name
        Write-Log "GPU Detected: $GPUName"
    
        if ($GPUName -match "RTX 40\d\d" -or $GPUName -match "RTX 50\d\d") {
            Write-Log "Modern NVIDIA GPU detected. Installing SageAttention for maximum performance..."
            # Try installing sageattention, but don't fail the whole install if it errors
            try {
                Run-Pip "install sageattention"
            } catch {
                Write-Log "WARNING: SageAttention installation failed (non-fatal)."
            }
        }
        else {
            Write-Log "Standard GPU architecture detected. Skipping SageAttention (using xformers/pytorch/sdpa)."
        }
    }
    catch {
        Write-Log "WARNING: GPU detection failed. Skipping SageAttention check."
    }
}
Install-SageAttention


# 11. Final Cleanup
Write-Log "Skipping desktop shortcut creation (use run.bat)."
Pause-Step

# 12. Smoke Test - verify core imports work
Write-Log "`n[Verification] Running installation smoke test..."
$SmokeTestScript = @"
import sys
errors = []
try:
    import torch
    gpu = torch.cuda.is_available()
    print(f'PyTorch {torch.__version__} - CUDA: {gpu}')
    if gpu:
        print(f'  GPU: {torch.cuda.get_device_name(0)}')
    else:
        if '+cpu' in torch.__version__:
            errors.append('PyTorch CPU-only version installed! CUDA build required.')
        else:
            errors.append('CUDA not available. Check NVIDIA drivers.')
except Exception as e:
    errors.append(f'PyTorch: {e}')

try:
    import transformers
    print(f'Transformers {transformers.__version__}')
except Exception as e:
    errors.append(f'Transformers: {e}')

try:
    import numpy
    print(f'NumPy {numpy.__version__}')
except Exception as e:
    errors.append(f'NumPy: {e}')

try:
    import PIL
    print(f'Pillow {PIL.__version__}')
except Exception as e:
    errors.append(f'Pillow: {e}')

try:
    import safetensors
    print(f'Safetensors OK')
except Exception as e:
    errors.append(f'Safetensors: {e}')

if errors:
    print(f'\nWARNING: {len(errors)} import(s) failed:')
    for e in errors:
        print(f'  - {e}')
    sys.exit(1)
else:
    print('\nAll core imports passed!')
    sys.exit(0)
"@
$SmokeTestFile = Join-Path $RootPath "smoke_test.py"
Set-Content -Path $SmokeTestFile -Value $SmokeTestScript
$SmokeResult = Start-Process -FilePath $PyExe -ArgumentList "$SmokeTestFile" -NoNewWindow -Wait -PassThru
Remove-Item $SmokeTestFile -Force

if ($SmokeResult.ExitCode -eq 0) {
    Write-Log "[Verification] Installation verified successfully!"
}
else {
    Write-Log "[Verification] WARNING: Some imports failed. The app may still work but check the log above."
}

Pause-Step

Write-Log "`n================================================"
Write-Log " ComfyUI Setup Complete!"
Write-Log " Returning to main installer..."
Write-Log "================================================"

# Stop transcript logging
try { Stop-Transcript } catch {}
Write-Log "Full log saved to: $TranscriptFile"

# Return to install.bat which handles the pause
Write-Host ""