@echo off
title PandaHead Calibrate Tool

cd /d "%~dp0"

echo.
echo ================================================
echo   PandaHead Anchor Calibrate Tool (DEV-only)
echo ================================================
echo.
echo Starting vite on port 5173...
echo Browser will open in 6 seconds.
echo Close this window to stop the dev server.
echo ================================================
echo.

REM Open browser after 6 seconds (give vite time to start)
start "" cmd /c "timeout /t 6 /nobreak >nul && start http://localhost:5173/?page=calibrate"

REM Run vite directly with forced port (avoids package.json script arg-passing quirks)
where bun >nul 2>nul
if %errorlevel%==0 (
  bun x vite --port 5173 --strictPort
) else (
  npx vite --port 5173 --strictPort
)

pause
