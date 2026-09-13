@echo off
setlocal
chcp 65001 >nul
title YouTube Downloader - Server
cd /d "%~dp0"

if not exist "runtime\node.exe" (
  echo [x] runtime\node.exe not found. Re-extract the package.
  pause
  exit /b 1
)

echo Starting YouTube Downloader... (keep this window open)
"runtime\node.exe" "runner.mjs"
echo.
echo Server stopped.
pause
