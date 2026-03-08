@echo off
cd /d "%~dp0"
title ComfyFront Launcher

:: ============================================================================
:: RE-ENTRANT SECTIONS (For separate windows)
:: ============================================================================
if "%1"==":launch_ollama" goto :launch_ollama
if "%1"==":launch_comfy" goto :launch_comfy

if "%1"==":launch_backend" goto :launch_backend
if "%1"==":launch_frontend" goto :launch_frontend

:: ============================================================================
:: MAIN LAUNCHER
:: ============================================================================

echo ============================================================================
echo   COMFYFRONT LAUNCHER
echo ============================================================================
echo.

:: 1. SETUP ENVIRONMENT
set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"

set "PYTHON=%BASE_DIR%\python_embeded\python.exe"
set "OLLAMA=%BASE_DIR%\ollama_embeded\ollama.exe"
set "PATH=%BASE_DIR%\python_embeded;%BASE_DIR%\python_embeded\Scripts;%BASE_DIR%\git\cmd;%BASE_DIR%\node_embeded;%PATH%"

:: 2. Start Ollama (if available)
if exist "%OLLAMA%" (
    echo [1/3] Starting Ollama LLM Engine...
    start "Ollama LLM Engine" /MIN cmd /k "call "%~f0" :launch_ollama"
    timeout /t 2 /nobreak >nul
) else (
    echo [INFO] Ollama not found, skipping...
)

:: 3. Start ComfyUI
echo [2/4] Starting ComfyUI Backend (Port 8199)...
start "ComfyUI Backend" /MIN cmd /k "call "%~f0" :launch_comfy"
timeout /t 3 /nobreak >nul

:: 4. Start Backend Audio Server
echo [3/4] Starting Audio Transcription Server (Port 8000)...
start "Audio Backend" /MIN cmd /k "call "%~f0" :launch_backend"
timeout /t 2 /nobreak >nul

:: 5. Start Frontend
echo [4/4] Starting ComfyFront UI (Port 5173)...
cd /d "%BASE_DIR%\frontend"

:: Ensure local bin is in path (fixes 'vite' not recognized)
set "PATH=%CD%\node_modules\.bin;%PATH%"

if not exist "node_modules" (
    echo [INFO] node_modules missing. Installing...
    call npm install
)

call npm run dev

pause
exit /b

:: ============================================================================
:: SUBROUTINE: OLLAMA
:: ============================================================================
:launch_ollama
set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"
set "OLLAMA=%BASE_DIR%\ollama_embeded\ollama.exe"
set "OLLAMA_MODELS=%BASE_DIR%\ollama_embeded\models"
set "OLLAMA_HOST=127.0.0.1:11434"

if exist "%OLLAMA%" (
    echo Running Portable Ollama...
    "%OLLAMA%" serve
) else (
    echo Portable Ollama not found. Trying system Ollama...
    ollama serve
)
if %errorlevel% neq 0 (
    echo [ERROR] Ollama crashed!
    pause
)
exit /b

:: ============================================================================
:: SUBROUTINE: COMFYUI
:: ============================================================================
:launch_comfy
set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"
set "COMFYUI_DIR=%BASE_DIR%\ComfyUI"
set "PYTHON=%BASE_DIR%\python_embeded\python.exe"
set "PATH=%BASE_DIR%\python_embeded;%BASE_DIR%\python_embeded\Scripts;%BASE_DIR%\git\cmd;%BASE_DIR%\node_embeded;%PATH%"

set COMFYUI_OFFLINE=1
set TORIO_USE_FFMPEG=0
set PYTHONUNBUFFERED=1
set PYTHONIOENCODING=utf-8
set PYTHONPATH=%COMFYUI_DIR%;%PYTHONPATH%

echo Clearing port 8199...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8199"') do taskkill /F /PID %%a 2>nul
timeout /t 1 >nul

cd /d "%COMFYUI_DIR%"
"%PYTHON%" -W ignore::FutureWarning -s -u main.py --windows-standalone-build --port 8199 --listen 127.0.0.1 --reserve-vram 4 --disable-cuda-malloc --enable-cors-header * --preview-method none --disable-auto-launch

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] ComfyUI crashed with error code %errorlevel%
    pause
)
exit /b

:: ============================================================================
:: SUBROUTINE: BACKEND AUDIO SERVER
:: ============================================================================
:launch_backend
set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"
set "BACKEND_DIR=%BASE_DIR%\backend"
set "PYTHON=%BASE_DIR%\python_embeded\python.exe"
set "PATH=%BASE_DIR%\python_embeded;%BASE_DIR%\python_embeded\Scripts;%PATH%"
set "PYTHONPATH=%BACKEND_DIR%;%PYTHONPATH%"

if not exist "%BACKEND_DIR%" (
    echo [ERROR] Backend directory missing: %BACKEND_DIR%
    pause
    exit /b
)

echo Clearing port 8000...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8000"') do taskkill /F /PID %%a 2>nul
timeout /t 1 >nul

cd /d "%BACKEND_DIR%"
"%PYTHON%" -u server.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Backend server crashed with error code %errorlevel%
    pause
)
exit /b
