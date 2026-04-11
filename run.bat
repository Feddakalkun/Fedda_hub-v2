@echo off
chcp 65001 >nul
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
:: SERVICE DISPATCH - background services, output goes to logs/
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
    call :launch_backend > "%BASE_DIR%\logs\backend_%RANDOM%_%RANDOM%.log" 2>&1
    exit
)
if "%1"==":svc_mockingbird" (
    if not exist "%BASE_DIR%\logs" mkdir "%BASE_DIR%\logs"
    call :launch_mockingbird > "%BASE_DIR%\logs\mockingbird.log" 2>&1
    exit
)
if "%1"==":svc_mockingbird_warmup" (
    if not exist "%BASE_DIR%\logs" mkdir "%BASE_DIR%\logs"
    call :warmup_mockingbird > "%BASE_DIR%\logs\mockingbird_warmup.log" 2>&1
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

echo [1/6] Auto-update disabled (updates are distributed manually)
echo.

:: ============================================================================
:: MAIN LAUNCHER: Start services
:: ============================================================================

call :cleanup_stale_services

:: 2. Start Ollama
if "%MODE%"=="portable" (
    if exist "%BASE_DIR%\ollama_embeded\ollama.exe" (
        echo [2/5] Starting Ollama...
        start "" /B "%~f0" :svc_ollama
        timeout /t 2 /nobreak >nul
    ) else (
        echo [2/6] Ollama not found - AI chat won't work
    )
) else (
    where ollama >nul 2>nul
    if not errorlevel 1 (
        echo [2/6] Starting Ollama...
        start "" /B "%~f0" :svc_ollama
        timeout /t 2 /nobreak >nul
    ) else (
        echo [2/6] Ollama not found - AI chat won't work
    )
)

:: 3. Start Mockingbird XTTS
echo [3/6] Starting Mockingbird XTTS (Port 8020)...
call :is_port_listening 8020
if errorlevel 1 (
    echo     Mockingbird already running.
) else (
    call :mockingbird_health
    if errorlevel 1 (
        echo     [WARN] Mockingbird runtime is missing or needs repair. Re-run INSTALL.bat or INSTALL-LITE.bat.
    ) else (
        start "" /B "%~f0" :svc_mockingbird
        start "" /B "%~f0" :svc_mockingbird_warmup
    )
)
timeout /t 2 /nobreak >nul

:: 4. Start ComfyUI
echo [4/6] Starting ComfyUI (Port 8199)...
call :is_port_listening 8199
if errorlevel 1 (
    echo     ComfyUI already running.
) else (
    start "FEDDA ComfyUI Console" cmd /k ""%~f0" :svc_comfy"
)
call :wait_for_port 8199 60 ComfyUI

:: 5. Start FastAPI Backend
echo [5/6] Starting Backend (Port 8000)...
call :is_port_listening 8000
if errorlevel 1 (
    echo     Backend already running.
) else (
    start "" /B "%~f0" :svc_backend
)
call :wait_for_port 8000 30 Backend

:: 6. Start Frontend
echo [6/6] Starting FEDDA UI (Port 5173)...
echo     Opening landing page immediately...
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
:: SUBROUTINE: CHECK IF TCP PORT IS LISTENING
:: Returns errorlevel 1 when listening, 0 when not listening.
:: ============================================================================
:is_port_listening
setlocal
set "CHECK_PORT=%~1"
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /R /C:":%CHECK_PORT% .*LISTENING"') do (
    endlocal
    exit /b 1
)
endlocal
exit /b 0

:: ============================================================================
:: SUBROUTINE: CLEAN UP STALE FEDDA SERVICE PROCESSES
:: ============================================================================
:cleanup_stale_services
if not exist "%BASE_DIR%\logs" mkdir "%BASE_DIR%\logs"
echo     Cleaning stale FEDDA service processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$base = [IO.Path]::GetFullPath('%BASE_DIR%');" ^
  "$procs = Get-CimInstance Win32_Process | Where-Object {" ^
  "  $_.CommandLine -and (" ^
  "    $_.CommandLine -like ('*' + $base + '\\python_embeded\\python.exe* -u server.py*') -or " ^
  "    $_.CommandLine -like ('*' + $base + '\\python_embeded\\python.exe* main.py*') -or " ^
  "    $_.CommandLine -like ('*' + $base + '\\mockingbird_tts\\venv\\Scripts\\python.exe*xtts_api_server*') -or " ^
  "    $_.CommandLine -like ('*' + $base + '\\frontend\\*vite*')" ^
  "  )" ^
  "};" ^
  "foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {} }" >nul 2>&1
timeout /t 1 /nobreak >nul
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
"%PYTHON%" -W ignore::FutureWarning -s -u main.py %COMFY_EXTRA_FLAGS% --port 8199 --listen 127.0.0.1 --reserve-vram 4 --disable-cuda-malloc --enable-cors-header * --preview-method auto --disable-auto-launch --enable-manager --enable-manager-legacy-ui

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
echo [%date% %time%] Checking backend Python dependencies...
"%PYTHON%" -c "import uvicorn, fastapi, requests, pydantic" >nul 2>&1
if %errorlevel% neq 0 (
    echo [%date% %time%] Installing missing backend dependencies...
    "%PYTHON%" -m pip install uvicorn fastapi requests python-multipart pydantic
)
echo [%date% %time%] Starting Backend...
"%PYTHON%" -u server.py

if %errorlevel% neq 0 (
    echo [%date% %time%] [ERROR] Backend crashed with error code %errorlevel%
)
exit /b

:: ============================================================================
:: SUBROUTINE: MOCKINGBIRD WARMUP
:: ============================================================================
:warmup_mockingbird
set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"

echo [%date% %time%] Waiting for Mockingbird on port 8020...
call :wait_for_port 8020 45 Mockingbird

echo [%date% %time%] Prewarming Mockingbird voice cache...
powershell -NoProfile -Command "$body = @{ text = 'Hello! How can I assist you today?'; speaker_wav = 'charlotte'; language = 'en' } | ConvertTo-Json; try { Invoke-RestMethod -Uri 'http://127.0.0.1:8020/tts_to_audio/' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 120 | Out-Null; Write-Host '[Warmup] Mockingbird prewarm complete.' } catch { Write-Host ('[Warmup] Mockingbird prewarm failed: ' + $_.Exception.Message); exit 1 }"
exit /b

:: ============================================================================
:: SUBROUTINE: MOCKINGBIRD XTTS
:: ============================================================================
:launch_mockingbird
set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"
set "MOCKINGBIRD_DIR=%BASE_DIR%\mockingbird_tts"
set "INTERNAL_MOCKINGBIRD_PY=%MOCKINGBIRD_DIR%\venv\Scripts\python.exe"
set "INTERNAL_MOCKINGBIRD_REPO=%MOCKINGBIRD_DIR%\xtts-api-server"
set "MOCKINGBIRD_SPEAKERS=%MOCKINGBIRD_DIR%\speakers"
set "MOCKINGBIRD_OUTPUT=%MOCKINGBIRD_DIR%\output"
set "MOCKINGBIRD_MODELS=%MOCKINGBIRD_DIR%\xtts_models"
set "EXTERNAL_MOCKINGBIRD_ROOT=%BASE_DIR%\..\Mockingbird-TTS-One-Click-Install-v2\MOCKINGBIRD-TTS"
set "EXTERNAL_MOCKINGBIRD_PY=%EXTERNAL_MOCKINGBIRD_ROOT%\venv\Scripts\python.exe"

call :detect_env

echo [%date% %time%] Checking Mockingbird XTTS...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /R /C:":8020 .*LISTENING"') do (
    echo [%date% %time%] Mockingbird already running on port 8020.
    exit /b 0
)

if not exist "%MOCKINGBIRD_SPEAKERS%" mkdir "%MOCKINGBIRD_SPEAKERS%"
if not exist "%MOCKINGBIRD_OUTPUT%" mkdir "%MOCKINGBIRD_OUTPUT%"
if not exist "%MOCKINGBIRD_MODELS%" mkdir "%MOCKINGBIRD_MODELS%"

if exist "%BASE_DIR%\scripts\setup_tts_audio.py" (
    "%PYTHON%" "%BASE_DIR%\scripts\setup_tts_audio.py" >nul 2>&1
)

call :mockingbird_health
if errorlevel 1 (
    echo [%date% %time%] [WARN] Internal Mockingbird runtime failed health check. Re-run installer to repair XTTS voice support.
    exit /b 1
)

if exist "%INTERNAL_MOCKINGBIRD_PY%" if exist "%INTERNAL_MOCKINGBIRD_REPO%" (
    echo [%date% %time%] Found internal Mockingbird runtime.
    cd /d "%INTERNAL_MOCKINGBIRD_REPO%"
    echo [%date% %time%] Starting Mockingbird XTTS from internal runtime...
    "%INTERNAL_MOCKINGBIRD_PY%" -m xtts_api_server --host 127.0.0.1 --port 8020 --device cuda --speaker-folder "%MOCKINGBIRD_SPEAKERS%" --output "%MOCKINGBIRD_OUTPUT%" --model-folder "%MOCKINGBIRD_MODELS%" --use-cache --lowvram
    if %errorlevel% neq 0 (
        echo [%date% %time%] [WARN] Internal Mockingbird XTTS exited with error code %errorlevel%.
    )
    exit /b
)

if exist "%EXTERNAL_MOCKINGBIRD_PY%" (
    echo [%date% %time%] Found external Mockingbird install: "%EXTERNAL_MOCKINGBIRD_ROOT%"
    if not exist "%EXTERNAL_MOCKINGBIRD_ROOT%\speakers\charlotte.wav" (
        copy /Y "%MOCKINGBIRD_SPEAKERS%\charlotte.wav" "%EXTERNAL_MOCKINGBIRD_ROOT%\speakers\charlotte.wav" >nul 2>&1
    )
    cd /d "%EXTERNAL_MOCKINGBIRD_ROOT%"
    echo [%date% %time%] Starting Mockingbird XTTS from external install...
    "%EXTERNAL_MOCKINGBIRD_PY%" -m xtts_api_server --host 127.0.0.1 --port 8020 --device cuda --speaker-folder "%EXTERNAL_MOCKINGBIRD_ROOT%\speakers" --output "%EXTERNAL_MOCKINGBIRD_ROOT%\output" --model-folder "%EXTERNAL_MOCKINGBIRD_ROOT%\xtts_models" --use-cache --lowvram
    if %errorlevel% neq 0 (
        echo [%date% %time%] [WARN] External Mockingbird XTTS exited with error code %errorlevel%.
    )
    exit /b
)

echo [%date% %time%] [WARN] No Mockingbird runtime installed. Re-run INSTALL.bat to install XTTS voice support.
exit /b

:mockingbird_health
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  ". '%BASE_DIR%\\scripts\\mockingbird_runtime.ps1';" ^
  "if (Test-MockingbirdRuntimeReady -RootPath '%BASE_DIR%') { exit 0 } else { exit 1 }" >nul 2>&1
exit /b %errorlevel%

