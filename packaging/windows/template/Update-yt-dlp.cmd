@echo off
setlocal
chcp 65001 >nul
title YouTube Downloader - Update yt-dlp
cd /d "%~dp0"

echo Updating yt-dlp to the latest version...
call "%~dp0Stop-YouTubeDownloader.cmd" >nul 2>&1

if not exist "tools" mkdir "tools"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $url='https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'; $out=Join-Path '%~dp0tools' 'yt-dlp.exe'; Write-Host 'Downloading...'; Invoke-WebRequest -Uri $url -OutFile ($out + '.new') -UseBasicParsing; Move-Item -Force ($out + '.new') $out; Write-Host '[ok] yt-dlp updated'"
if errorlevel 1 (
  echo [x] Update failed. Check your internet connection and try again.
) else (
  "tools\yt-dlp.exe" --version
)
pause
