$ErrorActionPreference = "Stop"
$ScriptPath = $PSScriptRoot
$RootPath = Split-Path -Parent $ScriptPath
Set-Location $RootPath

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "      COMFYFRONT UPDATE & REPAIR UTILITY" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

# Define Paths
$PyExe = Join-Path $RootPath "python_embeded\python.exe"

# Pre-flight Check: Ensure Python Exists
if (-not (Test-Path $PyExe)) {
    Write-Host "`n[ERROR] Embedded Python not found!" -ForegroundColor Red
    Write-Host "File missing: $PyExe" -ForegroundColor Gray
    Write-Host "It looks like this is a fresh folder or broken install."
    Write-Host "Please run 'install.bat' strictly BEFORE running update/repair." -ForegroundColor Yellow
    Write-Host "Updates require an existing python environment."
    exit 1
}

$ComfyDir = Join-Path $RootPath "ComfyUI"
$CustomNodesDir = Join-Path $ComfyDir "custom_nodes"
$VoxDir = Join-Path $CustomNodesDir "ComfyUI-VoxCPM"

# 1. Dependency Repair / Downgrade (Critical for Stability)
Write-Host "`n[1/4] Enforcing stable dependencies (Downgrading/Pinning)..." -ForegroundColor Yellow
$StableDeps = @(
    "torch==2.5.1",
    "torchvision==0.20.1", 
    "torchaudio==2.5.1",
    "transformers>=4.48.2,<5.0.0", 
    "accelerate>=0.26.0",
    "bitsandbytes", 
    "soundfile"
)
foreach ($dep in $StableDeps) {
    Write-Host "  - Ensuring $dep..."
    & $PyExe -m pip install "$dep" --index-url https://download.pytorch.org/whl/cu124 --extra-index-url https://pypi.org/simple
}

# Check and Install WanVideo Wrapper
$WanVideoDir = Join-Path $CustomNodesDir "ComfyUI-WanVideo-Wrapper"
if (-not (Test-Path $WanVideoDir)) {
    Write-Host "`n[WanVideo] Installing missing WanVideo nodes..." -ForegroundColor Yellow
    try {
        Set-Location $CustomNodesDir
        & git clone https://github.com/Kijai/ComfyUI-WanVideoWrapper.git $WanVideoDir
        
        if (Test-Path "$WanVideoDir\requirements.txt") {
            Write-Host "Installing requirements..."
            & $PyExe -m pip install -r "$WanVideoDir\requirements.txt"
        }
    }
    catch {
        Write-Host "Failed to install WanVideo Wrapper: $_" -ForegroundColor Red
    }
    Set-Location $RootPath
}


# Check and Install Fill-Nodes (Required for Audio Crop)
$FillDir = Join-Path $CustomNodesDir "ComfyUI_Fill-Nodes"
if (-not (Test-Path $FillDir)) {
    Write-Host "`n[FillNodes] Installing missing Fill-Nodes..." -ForegroundColor Yellow
    try {
        Set-Location $CustomNodesDir
        & git clone https://github.com/filliptm/ComfyUI_Fill-Nodes.git
        if (Test-Path "$FillDir\requirements.txt") {
            Write-Host "Installing requirements..."
            & $PyExe -m pip install -r "$FillDir\requirements.txt"
        }
    }
    catch {
        Write-Host "Failed to install Fill-Nodes: $_" -ForegroundColor Red
    }
    Set-Location $RootPath
}

# 2. Install VoxCPM (The new TTS engine)
Write-Host "`n[2/4] Installing VoxCPM TTS Node..." -ForegroundColor Yellow
if (-not (Test-Path $VoxDir)) {
    Write-Host "  - Cloning ComfyUI-VoxCPM..."
    Set-Location $CustomNodesDir
    git clone https://github.com/wildminder/ComfyUI-VoxCPM
    Set-Location $RootPath
}
else {
    Write-Host "  - Updating ComfyUI-VoxCPM..."
    Set-Location $VoxDir
    git pull
    Set-Location $RootPath
}

# 3. Install VoxCPM Dependencies
Write-Host "`n[3/4] Installing VoxCPM requirements..." -ForegroundColor Yellow
if (Test-Path "$VoxDir\requirements.txt") {
    & $PyExe -m pip install -r "$VoxDir\requirements.txt"
}

# 4. Setup Audio Assets
Write-Host "`n[4/4] Setting up audio assets..." -ForegroundColor Yellow
$SetupAudioScript = Join-Path $ScriptPath "setup_tts_audio.py"
if (Test-Path $SetupAudioScript) {
    & $PyExe $SetupAudioScript
}

# 4b. Patch Whisper Node for ComfyUI API compatibility
Write-Host "`n[4b] Patching Whisper Node..." -ForegroundColor Yellow
$WhisperPatchScript = Join-Path $ScriptPath "patch_whisper_node.py"
if (Test-Path $WhisperPatchScript) {
    & $PyExe $WhisperPatchScript
}

# 5. Frontend & Node.js Repair
Write-Host "`n[5/6] Repairing Node.js & Frontend..." -ForegroundColor Yellow
$NodeDir = Join-Path $RootPath "node_embeded"
$FrontendDir = Join-Path $RootPath "frontend"

if (Test-Path $NodeDir) {
    Write-Host "  - Ensuring npm/npx shims..."
    $NpmShim = Join-Path $NodeDir "node_modules\npm\bin\npm.cmd"
    $NpxShim = Join-Path $NodeDir "node_modules\npm\bin\npx.cmd"
    if (Test-Path $NpmShim) { Copy-Item $NpmShim $NodeDir -Force }
    if (Test-Path $NpxShim) { Copy-Item $NpxShim $NodeDir -Force }
}

if (Test-Path $FrontendDir) {
    Write-Host "  - Checking frontend dependencies..."
    $NpmCmd = Join-Path $NodeDir "npm.cmd"
    Set-Location $FrontendDir
    if (Test-Path $NpmCmd) {
        & "$NpmCmd" "install"
    }
    else {
        $NodeExe = Join-Path $NodeDir "node.exe"
        $NpmCli = Join-Path $NodeDir "node_modules\npm\bin\npm-cli.js"
        if (Test-Path $NpmCli) {
            & "$NodeExe" "$NpmCli" "install"
        }
    }
    Set-Location $RootPath
}

# 6. Cleanup Old Files
Write-Host "`n[6/6] Cleaning up deprecated files..." -ForegroundColor Yellow
$FilesToDelete = @(
    "check_vibevoice_files.py",
    "cleanup_vibevoice.py",
    "create_reference_audio.py",
    "debug-comfyui.bat",
    "debug_streamer.py",
    "debug_vibevoice.py",
    "fix_vibevoice_deps.bat",
    "reinstall_vibevoice_deps.bat",
    "repair_environment.bat",
    "setup_tts_audio.py",
    "test_load_model.py",
    "update_dependencies.bat",
    "VOICE_FEATURES_README.md"
)

# Clean up duplicate/legacy folders
$FoldersToDelete = @(
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
    "ComfyUI\custom_nodes\ComfyUI-Image-Saver"
)

# Clean up duplicate loading videos (now in frontend/public/loading/pingpong/)
$LegacyLoadingFiles = @(
    "frontend\public\loading\bg.mp4",
    "frontend\public\loading\done-loading.mp4",
    "frontend\public\loading\grok.mp4"
)

foreach ($file in $FilesToDelete) {
    $path = Join-Path $RootPath $file
    if (Test-Path $path) {
        Remove-Item -Path $path -Force -ErrorAction SilentlyContinue
        Write-Host "  - Removed: $file"
    }
}

foreach ($folder in $FoldersToDelete) {
    $path = Join-Path $RootPath $folder
    if (Test-Path $path) {
        Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  - Removed folder: $folder"
    }
}

foreach ($file in $LegacyLoadingFiles) {
    $path = Join-Path $RootPath $file
    if (Test-Path $path) {
        Remove-Item -Path $path -Force -ErrorAction SilentlyContinue
        Write-Host "  - Removed legacy: $file"
    }
}

Write-Host "`n===================================================" -ForegroundColor Green
Write-Host "   UPDATE COMPLETE - READY TO GENERATE!" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Green
Write-Host "You can now close this window and run 'run.bat'"
