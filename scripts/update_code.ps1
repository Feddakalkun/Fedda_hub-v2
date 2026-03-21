# ============================================================================
# FEDDA Code Update — Fast, minimal, pulls latest code from GitHub
# Used by auto-update in run.bat — focused on speed
# For full maintenance (custom nodes, deps), see update_logic.ps1
# ============================================================================

param([switch]$SilentMode)

$ErrorActionPreference = "Stop"
$ScriptPath = $PSScriptRoot
$RootPath = Split-Path -Parent $ScriptPath
Set-Location $RootPath

if (-not $SilentMode) {
    Write-Host "`n===================================================" -ForegroundColor Cyan
    Write-Host "  FEDDA CODE UPDATE" -ForegroundColor Cyan
    Write-Host "===================================================" -ForegroundColor Cyan
}

# ============================================================================
# GIT SETUP
# ============================================================================
$GitEmbedded = Join-Path $RootPath "git_embeded\cmd\git.exe"
if (Test-Path $GitEmbedded) {
    $GitExe = $GitEmbedded
    $env:PATH = "$(Split-Path $GitExe);$env:PATH"
} else {
    $GitExe = "git"
}

# Fix dubious ownership errors (local config only — never modify user's global gitconfig)
$env:GIT_CONFIG_GLOBAL = Join-Path $RootPath ".gitconfig"
& $GitExe config --file "$env:GIT_CONFIG_GLOBAL" --add safe.directory '*' 2>$null

# ============================================================================
# 1. CHECK IF GIT REPO EXISTS
# ============================================================================
if (-not (Test-Path (Join-Path $RootPath ".git"))) {
    if (-not $SilentMode) {
        Write-Host "`n  Initializing git from GitHub..." -ForegroundColor Yellow
    }
    & $GitExe init
    & $GitExe remote add origin https://github.com/Feddakalkun/comfyuifeddafront.git
}

# ============================================================================
# 2. PULL LATEST CODE
# ============================================================================
if (-not $SilentMode) {
    Write-Host "`n  Pulling latest code from GitHub..." -ForegroundColor Yellow
}

try {
    $ErrorActionPreference = "Continue"
    & $GitExe fetch origin main 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "git fetch failed"
    }
    & $GitExe reset --hard origin/main 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "git reset failed"
    }
    & $GitExe clean -fd 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"
    
    if (-not $SilentMode) {
        Write-Host "  ✓ Code updated successfully." -ForegroundColor Green
    }
} catch {
    if (-not $SilentMode) {
        Write-Host "  ⚠ Git update failed: $_" -ForegroundColor Yellow
    }
    exit 1
}

# ============================================================================
# 3. CLEANUP LEGACY FILES (Optional but fast)
# ============================================================================
$LegacyFiles = @(
    "UPDATE_APP.bat",
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
    "LOG.md",
    "install-fast.bat",
    "run-fast.bat",
    "UPDATE_APP_FULL.bat"
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
    "ComfyUI\custom_nodes\masquerade-nodes-comfyui",
    "ComfyUI\custom_nodes\chibi",
    "ComfyUI\custom_nodes\comfy-image-saver",
    "ComfyUI\custom_nodes\ComfyUI-Timer-Nodes",
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
        $CleanedCount++
    }
}

foreach ($folder in $LegacyFolders) {
    $path = Join-Path $RootPath $folder
    if (Test-Path $path) {
        Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue
        $CleanedCount++
    }
}

# ============================================================================
# DONE
# ============================================================================
if (-not $SilentMode) {
    if ($CleanedCount -gt 0) {
        Write-Host "  ✓ Cleaned up $CleanedCount legacy items." -ForegroundColor Green
    } else {
        Write-Host "  ✓ No legacy files to clean." -ForegroundColor Green
    }
    Write-Host "`n===================================================" -ForegroundColor Green
    Write-Host "  UPDATE COMPLETE" -ForegroundColor Green
    Write-Host "===================================================" -ForegroundColor Green
}

exit 0
