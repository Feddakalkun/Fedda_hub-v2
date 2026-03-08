@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title FEDDA Installer

set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"

echo.
echo ============================================================================
echo   FEDDA INSTALLER
echo ============================================================================
echo.
echo   Scanning your system...
echo.

:: ============================================================================
:: SYSTEM SCAN
:: ============================================================================

:: GPU Check — nvidia-smi -L gives clean output on all driver versions
set "GPU_OK=0"
set "GPU_NAME=Not detected"
for /f "tokens=1,* delims=:" %%a in ('nvidia-smi -L 2^>nul') do (
    if "!GPU_OK!"=="0" (
        set "GPU_OK=1"
        :: %%b = " NVIDIA GeForce RTX 3090 (UUID: ...)"
        :: Extract name before the UUID parenthesis
        set "_gpu=%%b"
        for /f "tokens=1 delims=(" %%n in ("%%b") do (
            :: Trim leading space
            for /f "tokens=*" %%t in ("%%n") do set "GPU_NAME=%%t"
        )
    )
)
if "!GPU_OK!"=="1" (
    echo   GPU:      !GPU_NAME!
) else (
    echo   GPU:      No NVIDIA GPU found
)

:: Check for system Python
set "HAS_PYTHON=0"
set "PY_VERSION="
where python >nul 2>nul
if %errorlevel% equ 0 (
    set "HAS_PYTHON=1"
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do set "PY_VERSION=%%v"
)

:: Check for system Git
set "HAS_GIT=0"
set "GIT_VERSION="
where git >nul 2>nul
if %errorlevel% equ 0 (
    set "HAS_GIT=1"
    for /f "tokens=*" %%v in ('git --version 2^>^&1') do set "GIT_VERSION=%%v"
)

:: Check for system Node
set "HAS_NODE=0"
set "NODE_VERSION="
where node >nul 2>nul
if %errorlevel% equ 0 (
    set "HAS_NODE=1"
    for /f "tokens=*" %%v in ('node --version 2^>^&1') do set "NODE_VERSION=%%v"
)

:: Check for system Ollama
set "HAS_OLLAMA=0"
where ollama >nul 2>nul
if %errorlevel% equ 0 (
    set "HAS_OLLAMA=1"
)

echo.
echo   System Tools Found:
if "%HAS_PYTHON%"=="1" (
    echo     Python:   %PY_VERSION%
) else (
    echo     Python:   not installed
)
if "%HAS_GIT%"=="1" (
    echo     Git:      %GIT_VERSION%
) else (
    echo     Git:      not installed
)
if "%HAS_NODE%"=="1" (
    echo     Node.js:  %NODE_VERSION%
) else (
    echo     Node.js:  not installed
)
if "%HAS_OLLAMA%"=="1" (
    echo     Ollama:   installed
) else (
    echo     Ollama:   not installed
)

:: ============================================================================
:: CHECK IF ALREADY INSTALLED
:: ============================================================================
if exist "%BASE_DIR%\python_embeded\python.exe" (
    echo.
    echo   [NOTE] Full install already detected (python_embeded found^).
    echo          Run UPDATE_APP.bat to update, or delete python_embeded to reinstall.
    echo.
    pause
    exit /b 0
)
if exist "%BASE_DIR%\venv\Scripts\python.exe" (
    echo.
    echo   [NOTE] Lite install already detected (venv found^).
    echo          Run UPDATE_APP.bat to update, or delete venv to reinstall.
    echo.
    pause
    exit /b 0
)

:: ============================================================================
:: NVIDIA CHECK
:: ============================================================================
if "%GPU_OK%"=="0" (
    echo.
    echo   ============================================================
    echo   ERROR: No NVIDIA GPU detected!
    echo   FEDDA requires an NVIDIA GPU with CUDA support.
    echo   AMD and Intel GPUs are not supported.
    echo   ============================================================
    echo.
    pause
    exit /b 1
)

:: ============================================================================
:: OFFER CHOICE
:: ============================================================================
echo.
echo ============================================================================
echo.
echo   Choose installation type:
echo.
echo   [1] FULL INSTALL  (Recommended^)
echo       Downloads Python, Node, Git, Ollama — everything included.
echo       Nothing else needed. Fully portable.
echo       ~15 GB total, takes longer.
echo.

if "%HAS_PYTHON%"=="1" if "%HAS_GIT%"=="1" if "%HAS_NODE%"=="1" (
    echo   [2] LITE INSTALL  (Faster^)
    echo       Uses your existing Python, Git, Node.
    echo       Smaller download, faster install.
    echo       Creates a venv for Python packages.
    echo.
    set "LITE_AVAILABLE=1"
) else (
    echo   [2] LITE INSTALL  (Unavailable — missing system tools^)
    echo       Requires Python, Git, and Node.js installed on your system.
    echo.
    set "LITE_AVAILABLE=0"
)

echo ============================================================================
echo.

:ask_choice
set "CHOICE="
set /p "CHOICE=  Enter 1 or 2 (default: 1): "
if "%CHOICE%"=="" set "CHOICE=1"

if "%CHOICE%"=="1" goto :do_full
if "%CHOICE%"=="2" goto :do_lite

echo   Invalid choice. Enter 1 or 2.
goto :ask_choice

:: ============================================================================
:: FULL INSTALL (Portable)
:: ============================================================================
:do_full
echo.
echo   Starting Full Install...
echo.

:: Request admin for portable install (needs to extract executables)
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo   Requesting Administrator privileges...
    powershell -Command "Start-Process -FilePath '%~f0' -ArgumentList 'FULL' -Verb RunAs -Wait"
    exit /b
)

:: Handle re-entry after admin elevation
if "%1"=="FULL" (
    cd /d "%~dp0"
    set "BASE_DIR=%~dp0"
    if "!BASE_DIR:~-1!"=="\" set "BASE_DIR=!BASE_DIR:~0,-1!"
)

powershell -ExecutionPolicy Bypass -File "%BASE_DIR%\scripts\install.ps1"

if %errorlevel% neq 0 (
    echo.
    echo   [ERROR] Installation failed! Check logs\install_full_log.txt
    echo.
    pause
    exit /b %errorlevel%
)

goto :done

:: ============================================================================
:: LITE INSTALL (System tools + venv)
:: ============================================================================
:do_lite
if "%LITE_AVAILABLE%"=="0" (
    echo.
    echo   Lite install requires Python, Git, and Node.js.
    echo   Install the missing tools or choose Full Install.
    echo.
    goto :ask_choice
)

echo.
echo   Starting Lite Install...
echo.

powershell -ExecutionPolicy Bypass -File "%BASE_DIR%\scripts\install_lite.ps1"

if %errorlevel% neq 0 (
    echo.
    echo   [ERROR] Installation failed! Check logs\install_fast_log.txt
    echo.
    pause
    exit /b %errorlevel%
)

goto :done

:: ============================================================================
:: DONE
:: ============================================================================
:done
echo.
echo ============================================================================
echo   INSTALLATION COMPLETE!
echo ============================================================================
echo.
echo   To start FEDDA, run:  RUN.bat
echo.
pause
