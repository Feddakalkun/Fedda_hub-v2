# ============================================================================
# FEDDA Lite Installer - Non-Portable (System Tools + venv)
# ============================================================================
# Assumes: Python 3.10+, Git, Node.js 18+, Ollama already on system
# Creates: venv, ComfyUI, custom nodes, frontend, backend - ready to run
# ============================================================================

$ErrorActionPreference = "Stop"
$ScriptPath = $PSScriptRoot
$RootPath = Split-Path -Parent $ScriptPath
$RootPath = (Resolve-Path $RootPath).Path
Set-Location $RootPath

# Logging
$LogsDir = Join-Path $RootPath "logs"
if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir | Out-Null }
$LogFile = Join-Path $LogsDir "install_fast_log.txt"

function Write-Step {
    param([string]$Message, [string]$Color = "White")
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "  [$ts] $Message" -ForegroundColor $Color
    Add-Content -Path $LogFile -Value "[$ts] $Message" -ErrorAction SilentlyContinue
}

function Write-Header {
    param([string]$Title)
    Write-Host ""
    Write-Host "  =================================================" -ForegroundColor DarkGray
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "  =================================================" -ForegroundColor DarkGray
}

function Test-Command {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-EmbeddedOllama {
    param([string]$RootPath, [string]$LogFile)
    
    $OllamaDir = Join-Path $RootPath "ollama_embeded"
    $OllamaExe = Join-Path $OllamaDir "ollama.exe"
    
    if (Test-Path $OllamaExe) {
        Write-Step "Embedded Ollama already installed." "Green"
        return $true
    }
    
    Write-Header "INSTALLING EMBEDDED OLLAMA"
    Write-Step "Downloading Ollama portable binary (v0.5.4)..." "Yellow"
    
    New-Item -ItemType Directory -Path $OllamaDir -Force | Out-Null
    $OllamaZip = Join-Path $OllamaDir "ollama.zip"
    
    try {
        # Download Ollama
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri "https://github.com/ollama/ollama/releases/download/v0.5.4/ollama-windows-amd64.zip" -OutFile $OllamaZip -UseBasicParsing
        
        Write-Step "Extracting Ollama..." "Yellow"
        Expand-Archive -Path $OllamaZip -DestinationPath $OllamaDir -Force
        Remove-Item $OllamaZip -Force
        
        Write-Step "Embedded Ollama installed successfully!" "Green"
        Write-Host "  Run 'ollama serve' to start Ollama." -ForegroundColor Gray
        return $true
    }
    catch {
        Write-Step "Failed to download Ollama: $_" "Red"
        return $false
    }
}

function Download-ZImageTurboCelebPack {
    param(
        [string]$PythonExe,
        [string]$ComfyDir
    )

    Write-Header "STEP 4.5/7 - Z-Image Turbo Celeb LoRA Pack"
    $TargetDir = Join-Path $ComfyDir "models\loras\zimage_turbo"
    if (-not (Test-Path $TargetDir)) {
        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    }

    $PyScript = Join-Path $env:TEMP "feddaz_zimage_turbo_sync_lite.py"
    $PyCode = @"
import json
import os
import subprocess
import sys
import urllib.request

repo = "pmczip/Z-Image-Turbo_Models"
target = r"$TargetDir"
api = f"https://huggingface.co/api/models/{repo}/tree/main"

os.makedirs(target, exist_ok=True)

with urllib.request.urlopen(api, timeout=60) as resp:
    items = json.loads(resp.read().decode("utf-8", errors="ignore"))

files = []
for item in items:
    p = str(item.get("path", "")).strip()
    if p.lower().endswith(".safetensors") and "/" not in p:
        files.append(p)

files = sorted(set(files))
print(f"[Z-Image Turbo] Found {len(files)} LoRA files")

downloaded = 0
skipped = 0
failed = 0

for i, name in enumerate(files, start=1):
    out = os.path.join(target, name)
    if os.path.exists(out) and os.path.getsize(out) > 10000:
        skipped += 1
        print(f"[{i}/{len(files)}] Skip existing: {name}")
        continue

    url = f"https://huggingface.co/{repo}/resolve/main/{name}"
    print(f"[{i}/{len(files)}] Download: {name}")
    cmd = ["curl.exe", "-L", "--retry", "3", "--retry-delay", "2", "-o", out, url]
    result = subprocess.run(cmd)
    if result.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 10000:
        downloaded += 1
    else:
        failed += 1
        try:
            if os.path.exists(out) and os.path.getsize(out) < 10000:
                os.remove(out)
        except Exception:
            pass

print(f"[Z-Image Turbo] Done. Downloaded={downloaded}, Skipped={skipped}, Failed={failed}")
sys.exit(0 if failed == 0 else 2)
"@
    Set-Content -Path $PyScript -Value $PyCode -Encoding UTF8

    try {
        & $PythonExe $PyScript
        if ($LASTEXITCODE -eq 0) {
            Write-Step "Z-Image Turbo celeb pack installed." "Green"
        } else {
            Write-Step "Z-Image Turbo download completed with partial failures (code $LASTEXITCODE)." "Yellow"
        }
    } catch {
        Write-Step "Z-Image Turbo download failed: $_" "Yellow"
    } finally {
        if (Test-Path $PyScript) {
            Remove-Item $PyScript -Force -ErrorAction SilentlyContinue
        }
    }
}


Clear-Host
Write-Host ""
Write-Host "  ========================================================" -ForegroundColor Cyan
Write-Host "                                                          " -ForegroundColor Cyan
Write-Host "         FEDDA LITE INSTALLER" -ForegroundColor Cyan
Write-Host "         Uses your system Python, Git, Node" -ForegroundColor Cyan
Write-Host "                                                          " -ForegroundColor Cyan
Write-Host "  ========================================================" -ForegroundColor Cyan
Write-Host ""

# --- Detect System Tools ---
Write-Header "SYSTEM CHECK"

$AllGood = $true

# Python
if (Test-Command "python") {
    $PyVersion = & python --version 2>&1
    $PyExe = (Get-Command python).Source
    Write-Step "Python:  $PyVersion  ($PyExe)" "Green"
} else {
    Write-Step "Python:  NOT FOUND - install from python.org" "Red"
    $AllGood = $false
}

# Git
if (Test-Command "git") {
    $GitVersion = & git --version 2>&1
    Write-Step "Git:     $GitVersion" "Green"
} else {
    Write-Step "Git:     NOT FOUND - install from git-scm.com" "Red"
    $AllGood = $false
}

# Node.js
if (Test-Command "node") {
    $NodeVersion = & node --version 2>&1
    Write-Step "Node.js: $NodeVersion" "Green"
} else {
    Write-Step "Node.js: NOT FOUND - install from nodejs.org" "Red"
    $AllGood = $false
}

# npm
if (Test-Command "npm") {
    $NpmVersion = & npm --version 2>&1
    Write-Step "npm:     v$NpmVersion" "Green"
} else {
    Write-Step "npm:     NOT FOUND" "Red"
    $AllGood = $false
}

# Ollama
# Ollama - check if installed AND running
$OllamaInstalled = $false
$OllamaRunning = $false
if (Test-Command "ollama") {
    $OllamaInstalled = $true
    # Try to connect to Ollama service (port 11434)
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($?) {
            $OllamaVersion = & ollama --version 2>&1
            Write-Step "Ollama:  $OllamaVersion (running)" "Green"
            $OllamaRunning = $true
        } else {
            Write-Step "Ollama:  Installed but NOT RUNNING" "Yellow"
        }
    } catch {
        Write-Step "Ollama:  Installed but NOT RUNNING" "Yellow"
    }
} else {
    Write-Step "Ollama:  NOT INSTALLED (optional - AI chat disabled)" "Yellow"
}

# NVIDIA GPU
try {
    $NvidiaGPU = Get-CimInstance Win32_VideoController -ErrorAction Stop | Where-Object { $_.Name -match "NVIDIA" } | Select-Object -First 1
    if ($NvidiaGPU) {
        $VRAM_MB = 0
        try {
            $SmiOut = & nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null
            if ($SmiOut) { $VRAM_MB = [int]($SmiOut.Trim()) }
        } catch {}
        $VRAMStr = ""
        if ($VRAM_MB -gt 0) { $VRAMStr = " ($([math]::Round($VRAM_MB / 1024)) GB VRAM)" }
        Write-Step "GPU:     $($NvidiaGPU.Name)$VRAMStr" "Green"
    } else {
        Write-Step "GPU:     No NVIDIA GPU found - CUDA required!" "Red"
        $AllGood = $false
    }
} catch {
    Write-Step "GPU:     Detection failed" "Yellow"
}

# RAM & Disk
$OSInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$RAM_GB = 0
if ($OSInfo) { $RAM_GB = [math]::Round($OSInfo.TotalVisibleMemorySize / 1MB) }
$Drive = (Get-Item $RootPath).PSDrive
$FreeGB = [math]::Round($Drive.Free / 1GB)

$RAMColor = "Yellow"
if ($RAM_GB -ge 16) { $RAMColor = "Green" }
Write-Step "RAM:     ${RAM_GB} GB" $RAMColor

$DiskColor = "Red"
if ($FreeGB -ge 10) { $DiskColor = "Green" }
elseif ($FreeGB -ge 5) { $DiskColor = "Yellow" }
Write-Step "Disk:    ${FreeGB} GB free on $($Drive.Name):\" $DiskColor

Write-Host ""

if (-not $AllGood) {
    Write-Host "  MISSING REQUIREMENTS - install the tools marked in red above." -ForegroundColor Red
    Write-Host ""
    Read-Host "  Press Enter to exit"
    exit 1
}

# Ollama Check (Warning if not running)
if (-not $OllamaRunning) {
    Write-Host ""
    Write-Host "  [!] OLLAMA NOT RUNNING" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Ollama is needed for the AI chat feature. Without it:" -ForegroundColor Yellow
    Write-Host "    - Agent Chat (text-to-speech, image caption) won't work" -ForegroundColor Gray
    Write-Host "    - Image generation, video, audio features WILL work normally" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Options:" -ForegroundColor White
    if ($OllamaInstalled) {
        Write-Host "    1) Continue install (Ollama will be used when you start it)" -ForegroundColor Gray
        Write-Host "    2) Cancel and start Ollama first (recommended)" -ForegroundColor Gray
        Write-Host "    3) Download & install embedded Ollama (portable, no system install needed)" -ForegroundColor Gray
    } else {
        Write-Host "    1) Continue install (skip AI chat)" -ForegroundColor Gray
        Write-Host "    2) Cancel and download Ollama from https://ollama.ai" -ForegroundColor Gray
        Write-Host "    3) Download & install embedded Ollama (portable, included)" -ForegroundColor Gray
    }
    Write-Host ""
    $OllamaChoice = Read-Host "  Enter 1, 2, or 3 (default: 1)"
    
    if ($OllamaChoice -eq "2") {
        Write-Host ""
        if ($OllamaInstalled) {
            Write-Host "  Start Ollama with: ollama serve" -ForegroundColor Cyan
            Write-Host "  Then run this installer again." -ForegroundColor White
        } else {
            Write-Host "  Download from https://ollama.ai" -ForegroundColor Cyan
            Write-Host "  Then run this installer again." -ForegroundColor White
        }
        Write-Host ""
        Read-Host "  Press Enter to exit"
        exit 0
    }
    elseif ($OllamaChoice -eq "3") {
        $EmbeddedSuccess = Install-EmbeddedOllama -RootPath $RootPath -LogFile $LogFile
        if (-not $EmbeddedSuccess) {
            Write-Host ""
            Write-Host "  Failed to download embedded Ollama. Check your internet connection." -ForegroundColor Red
            Write-Host "  You can still continue without it." -ForegroundColor Yellow
        } else {
            Write-Host "  Embedded Ollama is ready. It will start with run.bat." -ForegroundColor Green
            $OllamaRunning = $true
        }
    }
    
    if (-not $OllamaRunning) {
        Write-Host "  Continuing install without Ollama..." -ForegroundColor Yellow
    }
}

# Confirm
Write-Host "  All system tools detected. Root: $RootPath" -ForegroundColor Gray
Write-Host ""
$Confirm = Read-Host "  Press ENTER to install, or N to cancel"
if ($Confirm -eq "N" -or $Confirm -eq "n") { exit 0 }

$StopWatch = [System.Diagnostics.Stopwatch]::StartNew()

# ============================================================================
# 1. PYTHON VENV
# ============================================================================
Write-Header "STEP 1/7 - Python Virtual Environment"

$VenvDir = Join-Path $RootPath "venv"
$VenvPy = Join-Path $VenvDir "Scripts\python.exe"
$VenvPip = Join-Path $VenvDir "Scripts\pip.exe"

if (-not (Test-Path $VenvPy)) {
    Write-Step "Creating venv..."
    & python -m venv "$VenvDir"
    Write-Step "Upgrading pip..."
    & $VenvPy -m pip install --upgrade pip wheel setuptools --quiet
    Write-Step "venv created." "Green"
} else {
    Write-Step "venv already exists." "Green"
}

# Helper to run pip in venv
function Venv-Pip {
    param([string]$PipArgs)
    $cmd = "$VenvPy -m pip $PipArgs"
    Invoke-Expression $cmd
    if ($LASTEXITCODE -ne 0) {
        Write-Step "WARNING: pip command had issues: $PipArgs" "Yellow"
    }
}

# ============================================================================
# 2. COMFYUI
# ============================================================================
Write-Header "STEP 2/7 - ComfyUI Core"

$ComfyUICommit = "0467f69"  # Pinned stable
$ComfyDir = Join-Path $RootPath "ComfyUI"

if (-not (Test-Path $ComfyDir)) {
    Write-Step "Cloning ComfyUI..."
    $ErrorActionPreference = "Continue"
    $cloneOut = & git clone https://github.com/comfyanonymous/ComfyUI.git "$ComfyDir" 2>&1 | Out-String
    $ErrorActionPreference = "Stop"
    Set-Location $ComfyDir
    $ErrorActionPreference = "Continue"
    $checkoutOut = & git checkout $ComfyUICommit 2>&1 | Out-String
    $ErrorActionPreference = "Stop"
    Set-Location $RootPath
    Write-Step "ComfyUI cloned + pinned to $ComfyUICommit" "Green"
} else {
    Write-Step "ComfyUI already exists." "Green"
}

# ============================================================================
# 3. PYTORCH + CORE DEPS
# ============================================================================
Write-Header "STEP 3/7 - PyTorch + Dependencies"

Write-Step "Installing PyTorch (CUDA 12.4)... this takes a few minutes"
Venv-Pip "install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124"

Write-Step "Installing xformers..."
Venv-Pip "install xformers --index-url https://download.pytorch.org/whl/cu124"

Write-Step "Installing ComfyUI requirements..."
$ComfyReq = Join-Path $ComfyDir "requirements.txt"
Venv-Pip "install -r `"$ComfyReq`""

Write-Step "Installing build tools..."
Venv-Pip "install cmake ninja Cython"

Write-Step "Installing insightface..."
Venv-Pip "install insightface --prefer-binary --no-build-isolation"

# Comprehensive deps (same as portable)
Write-Step "Installing comprehensive dependencies..."
$Deps = @(
    "accelerate", "transformers", "diffusers", "safetensors",
    "huggingface-hub", "onnxruntime-gpu", "onnxruntime", "omegaconf",
    "aiohttp", "aiohttp-sse",
    "pytube", "yt-dlp", "moviepy", "youtube-transcript-api",
    "numba",
    "imageio", "imageio-ffmpeg", "av",
    "gdown", "pandas", "reportlab",
    "GPUtil", "wandb",
    "piexif", "rembg", "pillow-heif",
    "librosa", "soundfile",
    "beautifulsoup4", "lxml", "shapely",
    "deepdiff", "matplotlib", "scipy", "scikit-image", "scikit-learn",
    "timm", "colour-science", "blend-modes", "loguru",
    "ultralytics", "opencv-python-headless", "dill",
    "fastapi", "uvicorn[standard]", "python-multipart",
    "browser-cookie3", "edge-tts"
)
Venv-Pip "install $($Deps -join ' ')"

# SageAttention for 40/50-series
try {
    $GPUName = (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match "NVIDIA" } | Select-Object -First 1).Name
    if ($GPUName -match "RTX 40\d\d" -or $GPUName -match "RTX 50\d\d") {
        Write-Step "RTX 40/50 series detected - installing SageAttention..."
        Venv-Pip "install sageattention"
    }
} catch {}

Write-Step "All Python dependencies installed." "Green"

# ============================================================================
# 4. CUSTOM NODES
# ============================================================================
Write-Header "STEP 4/7 - Custom Nodes (from config/nodes.json)"

$NodesConfig = Get-Content (Join-Path $RootPath "config\nodes.json") | ConvertFrom-Json
$CustomNodesDir = Join-Path $ComfyDir "custom_nodes"
if (-not (Test-Path $CustomNodesDir)) { New-Item -ItemType Directory -Path $CustomNodesDir | Out-Null }

$Installed = 0; $Skipped = 0; $Failed = 0

foreach ($Node in $NodesConfig) {
    if ($Node.local -eq $true) {
        Write-Step "  [$($Node.name)] Local - skipped" "Gray"
        continue
    }

    $NodeDir = Join-Path $CustomNodesDir $Node.folder
    if (-not (Test-Path $NodeDir)) {
        Write-Step "  [$($Node.name)] Cloning..." "White"
        $ErrorActionPreference = "Continue"
        $out = & git clone --depth 1 $Node.url "$NodeDir" 2>&1 | Out-String
        $ErrorActionPreference = "Stop"

        if ($LASTEXITCODE -eq 0) {
            $Installed++
            # Install node requirements
            $ReqFile = Join-Path $NodeDir "requirements.txt"
            if (Test-Path $ReqFile) {
                $ErrorActionPreference = "Continue"
                & $VenvPy -m pip install -r "$ReqFile" --no-warn-script-location --quiet 2>&1 | Out-Null
                $ErrorActionPreference = "Stop"
            }
        } else {
            Write-Step "  [$($Node.name)] FAILED" "Red"
            $Failed++
        }
    } else {
        $Skipped++
    }
}

$NodeColor = "Green"
if ($Failed -gt 0) { $NodeColor = "Yellow" }
Write-Step "Nodes: $Installed installed, $Skipped already present, $Failed failed" $NodeColor

Write-Step "Skipping automatic Z-Image Turbo celeb pack download (available in UI on demand)." "Yellow"

# ============================================================================
# 5. FRONTEND
# ============================================================================
Write-Header "STEP 5/7 - Frontend (React + Vite)"

$FrontendDir = Join-Path $RootPath "frontend"
if (Test-Path $FrontendDir) {
    Set-Location $FrontendDir
    if (-not (Test-Path "node_modules")) {
        Write-Step "Running npm install..."
        & npm install 2>&1 | Out-Null
        Write-Step "Frontend dependencies installed." "Green"
    } else {
        Write-Step "node_modules already exists." "Green"
    }
    Set-Location $RootPath
} else {
    Write-Step "frontend/ directory not found!" "Red"
}

# ============================================================================
# 6. ASSETS + CONFIG
# ============================================================================
Write-Header "STEP 6/7 - Assets & Configuration"

# styles.csv
$StylesSrc = Join-Path $RootPath "assets\styles.csv"
if (Test-Path $StylesSrc) {
    Copy-Item -Path $StylesSrc -Destination $ComfyDir -Force
    Write-Step "styles.csv installed." "Green"
}

# Bundled LoRAs
$SrcLoras = Join-Path $RootPath "assets\loras\z-image"
$DstLoras = Join-Path $ComfyDir "models\loras\z-image"
if (Test-Path $SrcLoras) {
    if (-not (Test-Path $DstLoras)) { New-Item -ItemType Directory -Path $DstLoras -Force | Out-Null }
    Copy-Item -Path "$SrcLoras\*" -Destination $DstLoras -Recurse -Force
    Write-Step "Bundled LoRAs (Emmy, Zana) installed." "Green"
} else {
    Write-Step "No bundled LoRAs found (download_loras.bat later)." "Yellow"
}

# Audio TTS asset
$AudioScript = Join-Path $ScriptPath "setup_tts_audio.py"
if (Test-Path $AudioScript) {
    & $VenvPy "$AudioScript" 2>&1 | Out-Null
    Write-Step "TTS audio assets configured." "Green"
}

# ComfyUI-Manager config (weak security for auto-install)
$MgrDir = Join-Path $ComfyDir "user\__manager"
if (-not (Test-Path $MgrDir)) { New-Item -ItemType Directory -Path $MgrDir -Force | Out-Null }
$MgrConfig = @"
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
model_download_by_agent = False
downgrade_blacklist =
security_level = weak
always_lazy_install = False
network_mode = public
db_mode = remote
"@
Set-Content -Path (Join-Path $MgrDir "config.ini") -Value $MgrConfig
Write-Step "ComfyUI-Manager configured (weak security)." "Green"

# ============================================================================
# 7. SMOKE TEST
# ============================================================================
Write-Header "STEP 7/7 - Verification"

$SmokeCode = @"
import sys
ok = True
try:
    import torch
    gpu = torch.cuda.is_available()
    print(f'  PyTorch {torch.__version__} - CUDA: {gpu}')
    if gpu: print(f'  GPU: {torch.cuda.get_device_name(0)}')
    else: ok = False; print('  WARNING: CUDA not available!')
except Exception as e:
    ok = False; print(f'  PyTorch FAILED: {e}')

for lib in ['transformers', 'safetensors', 'numpy', 'PIL']:
    try:
        __import__(lib)
        print(f'  {lib}: OK')
    except:
        ok = False; print(f'  {lib}: FAILED')

sys.exit(0 if ok else 1)
"@
$SmokeFile = Join-Path $RootPath "_smoke_test.py"
Set-Content -Path $SmokeFile -Value $SmokeCode
$SmokeResult = Start-Process -FilePath $VenvPy -ArgumentList "$SmokeFile" -NoNewWindow -Wait -PassThru
Remove-Item $SmokeFile -Force

if ($SmokeResult.ExitCode -eq 0) {
    Write-Step "All core imports verified!" "Green"
} else {
    Write-Step "Some imports failed - check output above." "Yellow"
}

# Done
$StopWatch.Stop()
$Elapsed = $StopWatch.Elapsed
$TimeStr = "{0:mm}m {0:ss}s" -f $Elapsed
Write-Host ""
Write-Host "  ========================================================" -ForegroundColor Green
Write-Host "                                                          " -ForegroundColor Green
Write-Host "         INSTALLATION COMPLETE!                           " -ForegroundColor Green
Write-Host "         Time: $TimeStr                                   " -ForegroundColor Green
Write-Host "         Run: RUN.bat" -ForegroundColor Green
Write-Host "                                                          " -ForegroundColor Green
Write-Host "  ========================================================" -ForegroundColor Green
Write-Host ""
