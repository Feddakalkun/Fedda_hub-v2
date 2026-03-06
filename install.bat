@echo off
setlocal EnableDelayedExpansion

title ComfyFront - Universal Installer
cd /d "%~dp0"

echo ============================================================================
echo                    FEDDAKALKUN - ULTIMATE FRONTEND
echo ============================================================================
echo.
echo   This script will set up the entire ecosystem:
echo.
echo   1. ComfyUI (Generation Engine) + Custom Nodes
echo   2. Dashboard (React Frontend + FastAPI Backend)
echo   3. Ollama (AI Chat Engine)
echo.
echo   Embedded runtimes (installed locally, no system changes):
echo     Python 3.11.9  ^|  Node.js 22.14.0  ^|  MinGit 2.43.0  ^|  Ollama 0.5.4
echo.

:: Admin Check
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo   Requesting Administrator privileges...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs -Wait"
    exit /b
)

echo.
echo [Universal Installer] Handing over to PowerShell core...
echo.

powershell -ExecutionPolicy Bypass -File "scripts\install.ps1"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Installation failed! Check logs\install_full_log.txt for details.
    echo.
    echo Press any key to close...
    pause >nul
    exit /b %errorlevel%
)

echo.
echo ============================================================================
echo   INSTALLATION COMPLETE!
echo ============================================================================
echo.
echo   To start the system, run: run.bat
echo.
echo   Press any key to close...
pause >nul
