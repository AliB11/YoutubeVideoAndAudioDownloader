@echo off
setlocal
chcp 65001 >nul
title YouTube Downloader - Stop
cd /d "%~dp0"

echo Stopping YouTube Downloader...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$state = Join-Path '%~dp0' 'data\server.json'; if (Test-Path $state) { $j = Get-Content $state -Raw | ConvertFrom-Json; try { Stop-Process -Id $j.pid -Force -ErrorAction Stop; Write-Host ('[ok] server stopped (pid ' + $j.pid + ')') } catch { Write-Host '[i] server was not running' }; Remove-Item $state -Force } else { Write-Host '[i] no running server found' }"

rem اگر فرایند yt-dlp/ffmpeg جامانده بود، بسته می‌شود
taskkill /IM yt-dlp.exe /F >nul 2>&1
taskkill /IM ffmpeg.exe /F >nul 2>&1

echo Done.
timeout /t 3 >nul
