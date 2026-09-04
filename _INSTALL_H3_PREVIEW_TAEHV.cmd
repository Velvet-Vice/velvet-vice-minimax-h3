@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp005_INSTALLER\Install-H3-Preview-TAEHV.ps1"
if errorlevel 1 (
  echo.
  echo H3 TAEHV installation was not completed.
  pause
  exit /b 1
)
echo.
echo H3 TAEHV Preview Decoder is installed.
pause
