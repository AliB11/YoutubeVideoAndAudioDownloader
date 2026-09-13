<#
.SYNOPSIS
    ساخت بسته‌ی ویندوز «یوتیوب دانلودر»: نصب‌کننده‌ی EXE و نسخه‌ی قابل‌حمل ZIP.

.DESCRIPTION
    مراحل خودکار:
      ۱) بررسی‌های کیفیت (lint / typecheck / test) و بیلد production
      ۲) آماده‌سازی پوشه‌ی برنامه (وابستگی‌های production + .next + پیکربندی زمان‌اجرا)
      ۳) افزودن Node.js ویندوز، yt-dlp.exe و ffmpeg.exe
      ۴) آزمون سریع بسته (اجرای موقت سرور و بررسی پاسخ HTTP)
      ۵) ساخت ZIP قابل‌حمل و نصب‌کننده‌ی EXE با Inno Setup
      ۶) چک‌سام SHA256 و (اختیاری) انتشار در GitHub Releases

.PARAMETER Version
    نسخه‌ی بسته (مثلاً 1.0.0) — در نام فایل‌های خروجی استفاده می‌شود.

.PARAMETER NodeVersion
    نسخه‌ی Node.js ویندوز (مثلاً v24.10.0). خالی = آخرین نسخه‌ی LTS.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1 -Version 1.0.0 -AutoInstallInno

.EXAMPLE
    # فقط ZIP قابل‌حمل
    powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1 -Installer:$false
#>
[CmdletBinding()]
param(
    [string]$Version = "1.0.0",
    [string]$NodeVersion = "",
    [string]$Arch = "x64",
    [bool]$Portable = $true,
    [bool]$Installer = $true,
    [switch]$AutoInstallInno,
    [switch]$SkipChecks,
    [bool]$VerifyPackage = $true,
    [bool]$Clean = $true,
    [switch]$Publish,
    [string]$Repo = "AliB11/YoutubeVideoAndAudioDownloader"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# گزارش کامل در صورت بروز خطای پیش‌بینی‌نشده (برای عیب‌یابی در CI و اجرای محلی)
trap {
    Write-Host "`n[x] خطای غیرمنتظره در ساخت بسته" -ForegroundColor Red
    Write-Host "    نوع: $($_.Exception.GetType().FullName)" -ForegroundColor Red
    Write-Host "    پیام: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "    محل: $($_.InvocationInfo.PositionMessage)" -ForegroundColor DarkYellow
    Write-Host "    مسیر فراخوانی:`n$($_.ScriptStackTrace)" -ForegroundColor DarkGray
    exit 1
}

# ---------------------------------------------------------------------------
# مسیرها و توابع کمکی
# ---------------------------------------------------------------------------
$ScriptDir = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$DistDir = Join-Path $ScriptDir "dist"
$WorkDir = Join-Path $DistDir "work"
$AppDir = Join-Path $WorkDir "YouTubeDownloader"
$DownloadsDir = Join-Path $WorkDir "downloads"
$AssetsDir = Join-Path $ScriptDir "assets"
$TemplateDir = Join-Path $ScriptDir "template"
$NodeModulesDir = Join-Path $AppDir "node_modules"

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "    [ok] $Message" -ForegroundColor Green }
function Write-Info([string]$Message) { Write-Host "    [i]  $Message" -ForegroundColor Gray }
function Write-Warn2([string]$Message) { Write-Host "    [!]  $Message" -ForegroundColor Yellow }
function Fail([string]$Message) { Write-Host "`n[x] $Message" -ForegroundColor Red; exit 1 }

function Invoke-Download([string]$Url, [string]$Destination, [int]$Retries = 3) {
    for ($attempt = 1; $attempt -le $Retries; $attempt++) {
        try {
            Write-Info "downloading $(Split-Path $Url -Leaf) ($attempt/$Retries)"
            Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -TimeoutSec 900
            if ((Test-Path $Destination) -and ((Get-Item $Destination).Length -gt 0)) { return }
            throw "فایل دانلودشده خالی است"
        }
        catch {
            if ($attempt -eq $Retries) { throw }
            Start-Sleep -Seconds (3 * $attempt)
        }
    }
}

<#
    اجرای npm. خروجی stderr عمداً با stdout ادغام نمی‌شود؛ در PowerShell 5.1 ادغام
    stderr فرمان‌های بومی همراه با ErrorActionPreference=Stop خطای کاذب می‌دهد.
#>
function Invoke-Npm([string]$Arguments, [string]$WorkingDirectory, [bool]$AllowFailure = $false) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    Push-Location $WorkingDirectory
    try {
        Write-Info "npm $Arguments"
        $argv = $Arguments.Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)
        & npm @argv
        $code = $LASTEXITCODE
        if ($code -ne 0 -and -not $AllowFailure) { throw "npm $Arguments با کد $code ناموفق بود" }
        return $code
    }
    finally {
        $ErrorActionPreference = $previous
        Pop-Location
    }
}

function Copy-Tree([string]$Source, [string]$Destination) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    & robocopy $Source $Destination /E /NFL /NDL /NJH /NJS /NP /MT:16 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy از $Source به $Destination ناموفق بود (کد $LASTEXITCODE)" }
}

function Get-SizeMb([string]$Path) {
    if (-not (Test-Path $Path)) { return 0 }
    $bytes = (Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if (-not $bytes) { return 0 }
    return [math]::Round($bytes / 1MB, 1)
}

# ---------------------------------------------------------------------------
# ۰) پیش‌نیازها
# ---------------------------------------------------------------------------
Write-Step "بررسی پیش‌نیازها"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js روی PATH پیدا نشد. Node.js 20+ را از https://nodejs.org نصب کنید."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm پیدا نشد." }
$nodeOnPath = (& node --version).Trim()
$npmOnPath = (& npm --version).Trim()
Write-Ok "Node.js $nodeOnPath · npm $npmOnPath"
if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
    Fail "package.json پیدا نشد؛ این اسکریپت باید داخل مخزن پروژه اجرا شود."
}
Write-Info "ریشه‌ی مخزن: $RepoRoot"
Write-Info "نسخه‌ی بسته: $Version"

# ---------------------------------------------------------------------------
# ۱) بررسی‌های کیفیت و بیلد
# ---------------------------------------------------------------------------
if ($SkipChecks.IsPresent) {
    Write-Step "رد کردن بررسی‌های کیفیت (SkipChecks)"
} else {
    Write-Step "بررسی‌های کیفیت (lint / typecheck / test)"
    if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) { Invoke-Npm "ci" $RepoRoot }
    Invoke-Npm "run lint" $RepoRoot
    Invoke-Npm "run typecheck" $RepoRoot
    Invoke-Npm "run test" $RepoRoot
}

Write-Step "بیلد production برنامه"
if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) { Invoke-Npm "ci" $RepoRoot }
Invoke-Npm "run build" $RepoRoot
if (-not (Test-Path (Join-Path $RepoRoot ".next\BUILD_ID"))) { Fail "خروجی بیلد (.next) پیدا نشد." }
Write-Ok "بیلد انجام شد"

# ---------------------------------------------------------------------------
# ۲) آماده‌سازی پوشه‌ی برنامه
# ---------------------------------------------------------------------------
Write-Step "آماده‌سازی بسته"
if ($Clean -and (Test-Path $WorkDir)) { Remove-Item -Recurse -Force $WorkDir }
New-Item -ItemType Directory -Force -Path $AppDir, $DownloadsDir | Out-Null

Copy-Tree (Join-Path $RepoRoot "public") (Join-Path $AppDir "public")
Copy-Tree (Join-Path $RepoRoot ".next") (Join-Path $AppDir ".next")
Remove-Item -Recurse -Force (Join-Path $AppDir ".next\cache") -ErrorAction SilentlyContinue
Copy-Item (Join-Path $RepoRoot "package.json") $AppDir -Force
Copy-Item (Join-Path $RepoRoot "package-lock.json") $AppDir -Force
Write-Ok "فایل‌های برنامه کپی شدند"

# پیکربندی زمان‌اجرا: next.config.ts به .mjs کامپایل می‌شود تا هنگام اجرا نیازی به
# TypeScript/SWC نباشد (سرور سریع‌تر بالا می‌آید و دانلود اضافه انجام نمی‌دهد).
Write-Step "آماده‌سازی پیکربندی زمان‌اجرا"
$tscJs = Join-Path $RepoRoot "node_modules\typescript\bin\tsc"
$configOut = Join-Path $WorkDir "config"
$configOk = $false
if (Test-Path $tscJs) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    Push-Location $RepoRoot
    & node $tscJs "next.config.ts" --outDir $configOut --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
    $tscCode = $LASTEXITCODE
    Pop-Location
    $ErrorActionPreference = $previous
    $compiled = Join-Path $configOut "next.config.js"
    if ($tscCode -eq 0 -and (Test-Path $compiled)) {
        Copy-Item $compiled (Join-Path $AppDir "next.config.mjs") -Force
        Remove-Item (Join-Path $AppDir "next.config.ts") -Force -ErrorAction SilentlyContinue
        $configOk = $true
        Write-Ok "next.config.mjs ساخته شد"
    }
}
if (-not $configOk) {
    Copy-Item (Join-Path $RepoRoot "next.config.ts") $AppDir -Force
    Write-Warn2 "کامپایل پیکربندی انجام نشد؛ نسخه‌ی TypeScript کپی شد (در اولین اجرا به اینترنت نیاز دارد)."
}

# وابستگی‌های تولیدی
Write-Step "نصب وابستگی‌های production"
Invoke-Npm "ci --omit=dev --ignore-scripts --no-audit --no-fund" $AppDir
if (-not (Test-Path (Join-Path $NodeModulesDir "next"))) { Fail "نصب وابستگی‌های production ناموفق بود." }
Write-Ok "node_modules: $(Get-SizeMb $NodeModulesDir) مگابایت"

# حذف بسته‌های غیرضروری (کاهش حجم در حدود ۲۵۰ مگابایت)
Write-Step "حذف بسته‌های غیرضروری برای ویندوز"
# باینری‌های SWC در زمان اجرا لازم نیستند (بسته‌ی @next\env باقی می‌ماند)
Get-Item -Path (Join-Path $NodeModulesDir "@next\swc-*") -Force -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue
    Write-Info "removed @next\$($_.Name)"
}
foreach ($name in @("@img", "sharp")) {
    $target = Join-Path $NodeModulesDir $name
    if (Test-Path $target) {
        Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
        Write-Info "removed $name"
    }
}
Get-ChildItem -Path $NodeModulesDir -Recurse -Force -File -Include *.map -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
Write-Ok "node_modules پس از حذف: $(Get-SizeMb $NodeModulesDir) مگابایت"

# ---------------------------------------------------------------------------
# ۳) Node.js ویندوز
# ---------------------------------------------------------------------------
Write-Step "افزودن runtime ویندوز ($Arch)"
$runtimeDir = Join-Path $AppDir "runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

if (-not $NodeVersion) {
    try {
        $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -UseBasicParsing -TimeoutSec 120
        $lts = $index | Where-Object { $_.lts -ne $false } | Select-Object -First 1
        if ($lts) { $NodeVersion = $lts.version }
    }
    catch {
        Write-Warn2 "دریافت فهرست نسخه‌های Node.js ناموفق بود؛ نسخه‌ی پیش‌فرض استفاده می‌شود."
    }
}
if (-not $NodeVersion) { $NodeVersion = "v22.20.0" }
Write-Info "Node.js $NodeVersion ($Arch)"

$nodeZipName = "node-$NodeVersion-win-$Arch"
$nodeZip = Join-Path $DownloadsDir "$nodeZipName.zip"
if (-not (Test-Path $nodeZip)) {
    Invoke-Download "https://nodejs.org/dist/$NodeVersion/$nodeZipName.zip" $nodeZip
}
$nodeExtract = Join-Path $WorkDir "node"
if (Test-Path $nodeExtract) { Remove-Item -Recurse -Force $nodeExtract }
Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeExtract -Force
$nodeExe = Join-Path $nodeExtract "$nodeZipName\node.exe"
if (-not (Test-Path $nodeExe)) { Fail "node.exe در بسته‌ی دانلودشده پیدا نشد." }
Copy-Item $nodeExe (Join-Path $runtimeDir "node.exe") -Force
$nodeLicense = Join-Path $nodeExtract "$nodeZipName\LICENSE"
if (Test-Path $nodeLicense) { Copy-Item $nodeLicense (Join-Path $runtimeDir "LICENSE-node.txt") -Force }
Write-Ok "runtime\node.exe آماده شد"
Remove-Item -Recurse -Force $nodeExtract -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# ۴) ابزارها: yt-dlp و ffmpeg
# ---------------------------------------------------------------------------
Write-Step "افزودن ابزارها (yt-dlp و ffmpeg)"
$toolsDir = Join-Path $AppDir "tools"
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null

$ytdlpTarget = Join-Path $toolsDir "yt-dlp.exe"
$ytdlpLocal = Join-Path $AssetsDir "yt-dlp.exe"
if (Test-Path $ytdlpLocal) {
    Copy-Item $ytdlpLocal $ytdlpTarget -Force
    Write-Info "yt-dlp از پوشه‌ی assets استفاده شد"
} else {
    Invoke-Download "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" $ytdlpTarget
}
if (-not (Test-Path $ytdlpTarget) -or (Get-Item $ytdlpTarget).Length -lt 1MB) {
    Fail "yt-dlp.exe دریافت نشد. آن را دستی دانلود کنید و در packaging\windows\assets\yt-dlp.exe بگذارید."
}
Write-Ok "yt-dlp.exe ($([math]::Round((Get-Item $ytdlpTarget).Length / 1MB, 1)) مگابایت)"

$ffmpegTarget = Join-Path $toolsDir "ffmpeg.exe"
$ffmpegLocal = Join-Path $AssetsDir "ffmpeg.exe"
if (Test-Path $ffmpegLocal) {
    Copy-Item $ffmpegLocal $ffmpegTarget -Force
    Write-Info "ffmpeg از پوشه‌ی assets استفاده شد"
} else {
    # بسته‌ی رسمی npm برای ffmpeg ویندوز (بدون وابستگی به سایت‌های شخص ثالث)
    $packDir = Join-Path $WorkDir "ffmpeg-pack"
    New-Item -ItemType Directory -Force -Path $packDir | Out-Null
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    Push-Location $packDir
    & npm pack "@ffmpeg-installer/win32-x64" "--silent"
    Pop-Location
    $ErrorActionPreference = $previous
    $tarball = Get-ChildItem -Path $packDir -Filter "*.tgz" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $tarball) { Fail "دریافت بسته‌ی ffmpeg ناموفق بود (اتصال npm را بررسی کنید)." }
    & tar -xzf $tarball.FullName -C $packDir
    if ($LASTEXITCODE -ne 0) { Fail "باز کردن بسته‌ی ffmpeg ناموفق بود." }
    $ffmpegFile = Join-Path $packDir "package\ffmpeg.exe"
    if (-not (Test-Path $ffmpegFile)) { Fail "ffmpeg.exe در بسته‌ی npm پیدا نشد." }
    Copy-Item $ffmpegFile $ffmpegTarget -Force
}
Write-Ok "ffmpeg.exe ($([math]::Round((Get-Item $ffmpegTarget).Length / 1MB, 1)) مگابایت)"

# بررسی واقعی باینری‌ها روی ویندوز (نسخه‌ها برای گزارش ساخت نگه داشته می‌شوند)
$toolVersions = @{}
if ($IsWindows -or $env:OS -eq "Windows_NT") {
    Write-Step "بررسی ابزارهای ویندوزی بسته"
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    $toolVersions["node"] = ((& (Join-Path $runtimeDir "node.exe") --version) 2>&1 | Select-Object -First 1)
    $toolVersions["yt-dlp"] = ((& $ytdlpTarget --version) 2>&1 | Select-Object -First 1)
    $ffmpegLine = (& $ffmpegTarget -version 2>&1 | Select-Object -First 1)
    $toolVersions["ffmpeg"] = if ($ffmpegLine) { ($ffmpegLine -split " ")[2] } else { $null }

    $ErrorActionPreference = $previous

    foreach ($key in @("node", "yt-dlp", "ffmpeg")) {
        if (-not $toolVersions[$key]) { Fail "ابزار «$key» در بسته اجرا نشد؛ بسته‌ی دانلودشده سالم نیست." }
        Write-Ok "$key $($toolVersions[$key])"
    }
}

# ---------------------------------------------------------------------------
# ۵) فایل‌های راه‌انداز، آیکون و راهنما
# ---------------------------------------------------------------------------
Write-Step "افزودن فایل‌های راه‌انداز و آیکون"
foreach ($file in @("runner.mjs", "Start-YouTubeDownloader.cmd", "Stop-YouTubeDownloader.cmd", "Update-yt-dlp.cmd", "README.txt", ".env.example")) {
    $source = Join-Path $TemplateDir $file
    if (-not (Test-Path $source)) { Fail "فایل قالب پیدا نشد: $source" }
    Copy-Item $source $AppDir -Force
}

$previous = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& node (Join-Path $ScriptDir "tools\make-icon.mjs") (Join-Path $AssetsDir "app.ico")
$iconCode = $LASTEXITCODE
$ErrorActionPreference = $previous
if ($iconCode -ne 0) { Fail "ساخت آیکون ناموفق بود." }
Copy-Item (Join-Path $AssetsDir "app.ico") $AppDir -Force

foreach ($dir in @("data\downloads", "data\cache", "data\logs")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $AppDir $dir) | Out-Null
}

$commit = "unknown"
$previous = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$commitOutput = & git -C $RepoRoot rev-parse --short HEAD
if ($LASTEXITCODE -eq 0 -and $commitOutput) { $commit = "$commitOutput".Trim() }
$ErrorActionPreference = $previous

$versionInfo = @(
    "YouTube Downloader - Windows package",
    "Version: $Version",
    "BuiltAt: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "BundledNode: $NodeVersion ($Arch)",
    "BuildMachineNode: $nodeOnPath",
    "GitCommit: $commit"
) -join "`r`n"
Set-Content -Path (Join-Path $AppDir "VERSION.txt") -Value $versionInfo -Encoding UTF8
Write-Ok "فایل‌های راه‌انداز آماده شدند"

# ---------------------------------------------------------------------------
# ۶) آزمون سریع بسته
# ---------------------------------------------------------------------------
if ($VerifyPackage) {
    Write-Step "آزمون سریع بسته (اجرای موقت سرور)"
    $probePort = 3900 + (Get-Random -Minimum 0 -Maximum 90)
    $probeOut = Join-Path $WorkDir "probe.out.log"
    $probeErr = Join-Path $WorkDir "probe.err.log"
    $env:NODE_ENV = "production"
    $env:DEMO_MODE = "1"
    $probe = Start-Process -FilePath (Join-Path $runtimeDir "node.exe") `
        -ArgumentList @("node_modules\next\dist\bin\next", "start", "-H", "127.0.0.1", "-p", "$probePort") `
        -WorkingDirectory $AppDir -PassThru -NoNewWindow `
        -RedirectStandardOutput $probeOut -RedirectStandardError $probeErr
    $healthy = $false
    for ($i = 0; $i -lt 70; $i++) {
        Start-Sleep -Milliseconds 700
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$probePort/api/health" -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) { $healthy = $true; break }
        }
        catch { }
        if ($probe.HasExited) { break }
    }
    if (-not $probe.HasExited) { & taskkill /PID $probe.Id /T /F | Out-Null }
    Remove-Item Env:\DEMO_MODE -ErrorAction SilentlyContinue
    Remove-Item Env:\NODE_ENV -ErrorAction SilentlyContinue
    if ($healthy) {
        Write-Ok "سرور بسته‌بندی‌شده با موفقیت پاسخ داد (پورت آزمایشی $probePort)"
    } else {
        Get-Content $probeOut -ErrorAction SilentlyContinue | Select-Object -Last 15 | ForEach-Object { Write-Warn2 $_ }
        Get-Content $probeErr -ErrorAction SilentlyContinue | Select-Object -Last 15 | ForEach-Object { Write-Warn2 $_ }
        Fail "سرور بسته‌بندی‌شده بالا نیامد؛ لاگ بالا را بررسی کنید."
    }
}

# ---------------------------------------------------------------------------
# ۷) خروجی‌ها
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
$artifacts = @()

if ($Portable) {
    Write-Step "ساخت نسخه‌ی قابل‌حمل (ZIP)"
    $zipPath = Join-Path $DistDir "YouTubeDownloader-Portable-$Version-$Arch.zip"
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    Push-Location $WorkDir
    & tar.exe -a -c -f $zipPath "YouTubeDownloader"
    $tarCode = $LASTEXITCODE
    Pop-Location
    $ErrorActionPreference = $previous
    if ($tarCode -ne 0 -or -not (Test-Path $zipPath)) {
        Write-Warn2 "tar در دسترس نبود؛ از Compress-Archive استفاده می‌شود (کندتر است)"
        Compress-Archive -Path $AppDir -DestinationPath $zipPath -CompressionLevel Optimal -Force
    }
    $artifacts += $zipPath
    Write-Ok "$(Split-Path $zipPath -Leaf) — $([math]::Round((Get-Item $zipPath).Length / 1MB, 1)) مگابایت"
}

if ($Installer) {
    Write-Step "ساخت نصب‌کننده (Inno Setup)"
    $iscc = $null
    $candidates = @()
    if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe") }
    if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe") }
    if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 5\ISCC.exe") }
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { $iscc = $candidate; break }
    }
    if (-not $iscc) {
        $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
        if ($command) { $iscc = $command.Source }
    }
    if (-not $iscc -and $AutoInstallInno.IsPresent) {
        Write-Info "Inno Setup نصب نیست؛ تلاش برای نصب خودکار..."
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            & winget install --id JRSoftware.InnoSetup -e --silent --accept-package-agreements --accept-source-agreements
        }
        elseif (Get-Command choco -ErrorAction SilentlyContinue) {
            & choco install innosetup -y --no-progress
        }
        $ErrorActionPreference = $previous
        foreach ($candidate in $candidates) {
            if (Test-Path $candidate) { $iscc = $candidate; break }
        }
    }

    if (-not $iscc) {
        Write-Warn2 "Inno Setup پیدا نشد؛ نصب‌کننده ساخته نشد."
        Write-Warn2 "نصب: winget install JRSoftware.InnoSetup   یا   https://jrsoftware.org/isdl.php"
    }
    else {
        Write-Info "ISCC: $iscc"
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $iscc "/DAppVersion=$Version" "/DSourceDir=$AppDir" "/DOutputDir=$DistDir" "/DAssetsDir=$AssetsDir" (Join-Path $ScriptDir "installer.iss")
        $isccCode = $LASTEXITCODE
        $ErrorActionPreference = $previous
        if ($isccCode -ne 0) { Fail "ساخت نصب‌کننده با خطا متوقف شد (کد $isccCode)." }

        $setup = Join-Path $DistDir "YouTubeDownloader-Setup-$Version-$Arch.exe"
        if (-not (Test-Path $setup)) {
            $found = Get-ChildItem -Path $DistDir -Filter "YouTubeDownloader-Setup-*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) { $setup = $found.FullName }
        }
        if (-not (Test-Path $setup)) { Fail "فایل نصب‌کننده ساخته نشد." }
        $artifacts += $setup
        Write-Ok "$(Split-Path $setup -Leaf) — $([math]::Round((Get-Item $setup).Length / 1MB, 1)) مگابایت"
    }
}

# ---------------------------------------------------------------------------
# ۷.۵) بررسی یکپارچگی خروجی‌ها (ZIP و Setup.exe)
# ---------------------------------------------------------------------------
Write-Step "بررسی یکپارچگی خروجی‌ها"
$zipCheck = "portable zip: not built"
$setupCheck = "installer: not built"

if ($Portable -and $zipPath -and (Test-Path $zipPath)) {
    $entries = @()
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
        $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
        $entries = @($archive.Entries | ForEach-Object { $_.FullName })
        $archive.Dispose()
    }
    catch {
        Write-Warn2 "خواندن ZIP با .NET ناموفق بود؛ از tar استفاده می‌شود."
        $entries = @(& tar.exe -tf $zipPath)
    }
    $entries = $entries | ForEach-Object { "$_".Replace("\", "/") }

    # فایل‌های کلیدی باید داخل ZIP باشند، وگرنه بسته‌ی قابل‌حمل بی‌فایده است
    $required = @(
        "YouTubeDownloader/runtime/node.exe",
        "YouTubeDownloader/tools/yt-dlp.exe",
        "YouTubeDownloader/tools/ffmpeg.exe",
        "YouTubeDownloader/runner.mjs",
        "YouTubeDownloader/Start-YouTubeDownloader.cmd",
        "YouTubeDownloader/.next/BUILD_ID",
        "YouTubeDownloader/node_modules/next/package.json"
    )
    foreach ($item in $required) {
        if ($entries -notcontains $item) { Fail "فایل «$item» در ZIP قابل‌حمل پیدا نشد؛ بسته ناقص است." }
    }
    $zipCheck = "portable zip: ok ($($entries.Count) entries, $([math]::Round((Get-Item $zipPath).Length / 1MB, 1)) MB)"
    Write-Ok $zipCheck
}

if ($Installer -and $setup -and (Test-Path $setup)) {
    $stream = [System.IO.File]::OpenRead($setup)
    $head = New-Object byte[] 2
    $null = $stream.Read($head, 0, 2)
    $stream.Close()
    if ($head[0] -ne 0x4D -or $head[1] -ne 0x5A) {
        Fail "فایل نصب، اجراپذیر ویندوزی (PE/MZ) نیست؛ ساخت ناقص است."
    }
    $setupMb = [math]::Round((Get-Item $setup).Length / 1MB, 1)
    if ($setupMb -lt 30) { Fail "حجم فایل نصب ($setupMb مگابایت) غیرعادی کوچک است." }
    $setupCheck = "setup exe: ok (PE header, $setupMb MB)"
    Write-Ok $setupCheck
}

# ---------------------------------------------------------------------------
# ۸) چک‌سام و انتشار (اختیاری)
# ---------------------------------------------------------------------------
Write-Step "محاسبه‌ی SHA256"
$sumFile = Join-Path $DistDir "SHA256SUMS.txt"
$lines = @()
$hashes = @{}
foreach ($artifact in $artifacts) {
    $hash = (Get-FileHash -Path $artifact -Algorithm SHA256).Hash.ToLower()
    $hashes[(Split-Path $artifact -Leaf)] = $hash
    $lines += "$hash  $(Split-Path $artifact -Leaf)"
    Write-Ok "$(Split-Path $artifact -Leaf): $hash"
}
Set-Content -Path $sumFile -Value ($lines -join "`r`n") -Encoding ASCII

# گزارش ساخت (در یادداشت انتشار و به‌عنوان فایل ضمیمه استفاده می‌شود)
$reportLines = @(
    "YouTube Downloader - Windows package build report",
    "Version      : $Version",
    "Architecture : $Arch",
    "BuiltAt      : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "GitCommit    : $commit",
    "",
    "Bundled runtimes:",
    "  node   : $($toolVersions['node'])",
    "  yt-dlp : $($toolVersions['yt-dlp'])",
    "  ffmpeg : $($toolVersions['ffmpeg'])",
    "",
    "Installed size (unpacked): $(Get-SizeMb $AppDir) MB",
    "",
    "Package integrity:",
    "  $zipCheck",
    "  $setupCheck",
    "",
    "Artifacts:"
)
foreach ($artifact in $artifacts) {
    $name = Split-Path $artifact -Leaf
    $reportLines += ("  {0}  ({1} MB)" -f $name, [math]::Round((Get-Item $artifact).Length / 1MB, 1))
    if ($hashes[$name]) { $reportLines += "    sha256: $($hashes[$name])" }
}
$reportFile = Join-Path $DistDir "BUILD-REPORT.txt"
Set-Content -Path $reportFile -Value ($reportLines -join "`r`n") -Encoding UTF8
$artifacts += $sumFile
$artifacts += $reportFile

if ($Publish) {
    Write-Step "انتشار در GitHub Releases"
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "GitHub CLI (gh) نصب نیست." }
    $tag = "v$Version"
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & gh release view $tag --repo $Repo 2>&1 | Out-Null
    $releaseExists = ($LASTEXITCODE -eq 0)
    if (-not $releaseExists) {
        $notes = "بسته‌ی ویندوز «یوتیوب دانلودر»`n`nنصب‌کننده (Setup) و نسخه‌ی قابل‌حمل (Portable) در فایل‌های زیر موجود است.`nپس از نصب، از منوی استارت «یوتیوب دانلودر» را اجرا کنید."
        & gh release create $tag --repo $Repo --title "یوتیوب دانلودر $Version" --notes $notes
    }
    foreach ($artifact in $artifacts) {
        & gh release upload $tag $artifact --repo $Repo --clobber
    }
    $ErrorActionPreference = $previous
    Write-Ok "منتشر شد: https://github.com/$Repo/releases/tag/$tag"
}

# ---------------------------------------------------------------------------
# خلاصه
# ---------------------------------------------------------------------------
Write-Host "`n==================== خلاصه ====================" -ForegroundColor Cyan
Write-Host "حجم بسته‌ی نصب‌شده: $(Get-SizeMb $AppDir) مگابایت" -ForegroundColor White
foreach ($artifact in $artifacts) {
    $size = [math]::Round((Get-Item $artifact).Length / 1MB, 1)
    Write-Host ("  •  {0,-44} {1,7} MB" -f (Split-Path $artifact -Leaf), $size) -ForegroundColor White
}
Write-Host "  •  محل خروجی: $DistDir" -ForegroundColor Gray
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "نصب: فایل Setup را اجرا کنید (بدون نیاز به دسترسی مدیر).`n" -ForegroundColor Green
