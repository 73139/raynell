@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0ManualMapOverlay.ps1"
if errorlevel 1 (
  echo The manual overlay could not start. Check the error dialog.
  pause
)
