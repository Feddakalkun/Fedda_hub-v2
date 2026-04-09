@echo off
cd /d "%~dp0"
title FEDDA Launcher

set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"

:: Keep all ML caches inside install folder (never write to %USERPROFILE%\.cache)
set "HF_HOME=%BASE_DIR%\cache\huggingface"
set "TORCH_HOME=%BASE_DIR%\cache\torch"
set "INSIGHTFACE_ROOT=%BASE_DIR%\cache\insightface"
set "PIP_CACHE_DIR=%BASE_DIR%\cache\pip"

:: ============================================================================
:: SERVICE DISPATCH — background services, output goes to logs/
:: ============================================================================
if "%1"==":svc_ollama" (
    if not exist "%BASE_DIR%\logs" mkdir "%BASE_DIR%\logs"
    call :launch_ollama > "%BASE_DIR%\logs\ollama.log" 2>&1
    exit
)
if "%1"==":svc_comfy" (
    call :launch_comfy
    exit
)
if "%1"==":svc_backend" (
    if not exist "%BASE_DIR%\logs" mkdir "%BASE_DIR%\logs"
    call :launch_backend > "%BASE_DIR%\logs\backend.log" 2>&1
    exit
)

:: ============================================================================
:: ENTRY POINT: Detect environment and launch
:: ============================================================================
call :detect_env

echo.
echo ============================================================================
echo   FEDDA LAUNCHER  (%MODE% mode)
echo ============================================================================
echo.

echo [1/5] Auto-update disabled (updates are distributed manually)
echo.

:: ============================================================================
:: MAIN LAUNCHER: Start services
:: ============================================================================

:: 2. Start Ollama
if "%MODE%"=="portable" (
    if exist "%BASE_DIR%\ollama_embeded\ollama.exe" (
        echo [2/5] Starting Ollama...
        start "" /B "%~f0" :svc_ollama
        timeout /t 2 /nobreak >nul
    ) else (
        echo [2/5] Ollama not found — AI chat won't work
    )
) else (
    where ollama >nul 2>nul
    if not errorlevel 1 (
        echo [2/5] Starting Ollama...
        start "" /B "%~f0" :svc_ollama
        timeout /t 2 /nobreak >nul
    ) else (
        echo [2/5] Ollama not found — AI chat won't work
    )
)

:: 3. Start ComfyUI
echo [3/5] Starting ComfyUI (Port 8199)...
start "FEDDA ComfyUI Console" cmd /k ""%~f0" :svc_comfy"

:: 4. Start FastAPI Backend
echo [4/5] Starting Backend (Port 8000)...
start "" /B "%~f0" :svc_backend

:: 5. Start Frontend immediately (landing sequence handles warm-up state)
echo [5/5] Starting FEDDA UI (Port 5173)...
echo     Opening UI immediately while services finish booting...
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
:: SUBROUTINE: WAIT FOR TCP PORT LISTENING
:: ============================================================================
:wait_for_port
setlocal EnableDelayedExpansion
set "WAIT_PORT=%~1"
set "WAIT_MAX=%~2"
set "WAIT_NAME=%~3"
set /a WAIT_ELAPSED=0

:wait_loop
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /R /C:":%WAIT_PORT% .*LISTENING"') do (
    endlocal
    exit /b 0
)

if !WAIT_ELAPSED! GEQ !WAIT_MAX! (
    echo     [WARN] %WAIT_NAME% did not become ready within %WAIT_MAX%s. Continuing...
    endlocal
    exit /b 1
)

timeout /t 1 /nobreak >nul
set /a WAIT_ELAPSED+=1
goto :wait_loop

:: ============================================================================
:: SUBROUTINE: DETECT ENVIRONMENT (Portable vs Lite)
:: ============================================================================
:detect_env
set "MODE="
if exist "%BASE_DIR%\python_embeded\python.exe" (
    set "MODE=portable"
    set "PYTHON=%BASE_DIR%\python_embeded\python.exe"
    set "PATH=%BASE_DIR%\python_embeded;%BASE_DIR%\python_embeded\Scripts;%BASE_DIR%\git\cmd;%BASE_DIR%\node_embeded;%PATH%"
    set "COMFY_EXTRA_FLAGS=--windows-standalone-build"
) else if exist "%BASE_DIR%\venv\Scripts\python.exe" (
    set "MODE=lite"
    set "PYTHON=%BASE_DIR%\venv\Scripts\python.exe"
    set "COMFY_EXTRA_FLAGS="
) else (
    echo.
    echo [ERROR] No Python environment found!
    echo        Run INSTALL.bat or INSTALL-LITE.bat first.
    echo.
    pause
    exit /b 1
)
exit /b

:: ============================================================================
:: SUBROUTINE: OLLAMA
:: ============================================================================
:launch_ollama
set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"
set "OLLAMA_HOST=127.0.0.1:11434"

echo [%date% %time%] Starting Ollama...
if exist "%BASE_DIR%\ollama_embeded\ollama.exe" (
    set "OLLAMA_MODELS=%BASE_DIR%\ollama_embeded\models"
    "%BASE_DIR%\ollama_embeded\ollama.exe" serve
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

:: Detect Python (call detect_env subroutine)
call :detect_env

set COMFYUI_OFFLINE=1
set TORIO_USE_FFMPEG=0
set PYTHONUNBUFFERED=1
set PYTHONIOENCODING=utf-8
set PYTHONPATH=%COMFYUI_DIR%;%PYTHONPATH%

echo [%date% %time%] Clearing port 8199...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8199"') do (taskkill /F /PID %%a >nul 2>&1)
timeout /t 1 /nobreak >nul

cd /d "%COMFYUI_DIR%"
echo [%date% %time%] Starting ComfyUI...
"%PYTHON%" -W ignore::FutureWarning -s -u main.py %COMFY_EXTRA_FLAGS% --port 8199 --listen 127.0.0.1 --reserve-vram 4 --disable-cuda-malloc --enable-cors-header * --preview-method auto --disable-auto-launch

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

:: Detect Python (call detect_env subroutine)
call :detect_env
set "PYTHONPATH=%BACKEND_DIR%;%PYTHONPATH%"

echo [%date% %time%] Clearing port 8000...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8000"') do (taskkill /F /PID %%a >nul 2>&1)
timeout /t 1 /nobreak >nul

cd /d "%BACKEND_DIR%"
echo [%date% %time%] Starting Backend...
"%PYTHON%" -u server.py

if %errorlevel% neq 0 (
    echo [%date% %time%] [ERROR] Backend crashed with error code %errorlevel%
)
exit /b
