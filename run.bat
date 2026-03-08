@echo off
cd /d "%~dp0"
title FEDDA Launcher

set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"

:: ============================================================================
:: SERVICE DISPATCH — background services, output goes to logs/
:: ============================================================================
if "%1"==":svc_ollama" (
    if not exist "%BASE_DIR%\logs" mkdir "%BASE_DIR%\logs"
    call :launch_ollama > "%BASE_DIR%\logs\ollama.log" 2>&1
    exit
)
if "%1"==":svc_comfy" (
    if not exist "%BASE_DIR%\logs" mkdir "%BASE_DIR%\logs"
    call :launch_comfy > "%BASE_DIR%\logs\comfyui.log" 2>&1
    exit
)
if "%1"==":svc_backend" (
    if not exist "%BASE_DIR%\logs" mkdir "%BASE_DIR%\logs"
    call :launch_backend > "%BASE_DIR%\logs\backend.log" 2>&1
    exit
)

:: ============================================================================
:: MAIN LAUNCHER — Portable (uses embedded Python/Node/Git)
:: ============================================================================
echo.
echo ============================================================================
echo   FEDDA LAUNCHER
echo ============================================================================
echo.

:: Setup embedded tools
set "PYTHON=%BASE_DIR%\python_embeded\python.exe"
set "OLLAMA=%BASE_DIR%\ollama_embeded\ollama.exe"
set "PATH=%BASE_DIR%\python_embeded;%BASE_DIR%\python_embeded\Scripts;%BASE_DIR%\git\cmd;%BASE_DIR%\node_embeded;%PATH%"

:: 1. Start Ollama (if available)
if exist "%OLLAMA%" (
    echo [1/4] Starting Ollama...
    start "" /B "%~f0" :svc_ollama
    timeout /t 2 /nobreak >nul
) else (
    echo [1/4] Ollama not found — AI chat won't work
)

:: 2. Start ComfyUI
echo [2/4] Starting ComfyUI (Port 8199)...
start "" /B "%~f0" :svc_comfy
timeout /t 3 /nobreak >nul

:: 3. Start FastAPI Backend
echo [3/4] Starting Backend (Port 8000)...
start "" /B "%~f0" :svc_backend
timeout /t 2 /nobreak >nul

:: 4. Start Frontend (runs in this window)
echo [4/4] Starting FEDDA UI (Port 5173)...
echo.
echo   Logs:  %BASE_DIR%\logs\
echo   Close this window to stop all services.
echo.
cd /d "%BASE_DIR%\frontend"
set "PATH=%CD%\node_modules\.bin;%PATH%"

if not exist "node_modules" (
    echo [INFO] node_modules missing, running npm install...
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

echo [%date% %time%] Starting Ollama...
if exist "%OLLAMA%" (
    "%OLLAMA%" serve
) else (
    ollama serve
)
if %errorlevel% neq 0 (
    echo [ERROR] Ollama crashed with error code %errorlevel%
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

echo [%date% %time%] Clearing port 8199...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8199"') do taskkill /F /PID %%a 2>nul
timeout /t 1 /nobreak >nul

cd /d "%COMFYUI_DIR%"
echo [%date% %time%] Starting ComfyUI...
"%PYTHON%" -W ignore::FutureWarning -s -u main.py --windows-standalone-build --port 8199 --listen 127.0.0.1 --reserve-vram 4 --disable-cuda-malloc --enable-cors-header * --preview-method none --disable-auto-launch

if %errorlevel% neq 0 (
    echo [%date% %time%] [ERROR] ComfyUI crashed with error code %errorlevel%
)
exit /b

:: ============================================================================
:: SUBROUTINE: BACKEND
:: ============================================================================
:launch_backend
set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"
set "BACKEND_DIR=%BASE_DIR%\backend"
set "PYTHON=%BASE_DIR%\python_embeded\python.exe"
set "PATH=%BASE_DIR%\python_embeded;%BASE_DIR%\python_embeded\Scripts;%PATH%"
set "PYTHONPATH=%BACKEND_DIR%;%PYTHONPATH%"

echo [%date% %time%] Clearing port 8000...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8000"') do taskkill /F /PID %%a 2>nul
timeout /t 1 /nobreak >nul

cd /d "%BACKEND_DIR%"
echo [%date% %time%] Starting Backend...
"%PYTHON%" -u server.py

if %errorlevel% neq 0 (
    echo [%date% %time%] [ERROR] Backend crashed with error code %errorlevel%
)
exit /b
