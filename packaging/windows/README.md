# 🪟 بسته‌ی ویندوز — یوتیوب دانلودر

با این پوشه می‌توانید از برنامه یک **نصب‌کننده‌ی `.exe`** و یک **نسخه‌ی قابل‌حمل `.zip`** بسازید که
بدون نیاز به نصب Node.js، npm، yt-dlp یا ffmpeg روی رایانه‌ی کاربر اجرا می‌شوند.

| خروجی | توضیح |
|---|---|
| `YouTubeDownloader-Setup-<version>-x64.exe` | نصب‌کننده با Inno Setup — نصب برای کاربر جاری، **بدون نیاز به دسترسی مدیر (UAC)**، میانبر منوی استارت/میزکار، حذف‌کننده‌ی کامل |
| `YouTubeDownloader-Portable-<version>-x64.zip` | نسخه‌ی قابل‌حمل — از حالت فشرده خارج کنید و `Start-YouTubeDownloader.cmd` را اجرا کنید |
| `SHA256SUMS.txt` | چک‌سام فایل‌های خروجی |

---

## ۱) ساخت خودکار روی GitHub (پیشنهادی، بدون نیاز به ویندوز)

گردش‌کار `.github/workflows/windows-package.yml` بسته را روی رانر ویندوزی گیت‌هاب می‌سازد:

1. **تب Actions → Windows package → Run workflow** (نسخه را وارد کنید و در صورت نیاز
   «انتشار در GitHub Releases» را روشن کنید).  
   نتیجه در همان اجرا، بخش **Artifacts** قابل دانلود است.
2. یا با push یک تگ نسخه، مثل `v1.0.0`، بسته ساخته **و به Releases منتشر** می‌شود؛
   کاربران می‌توانند مستقیم از صفحه‌ی Releases فایل `Setup.exe` را دانلود و نصب کنند.

> انتشار در Releases از `GITHUB_TOKEN` خودِ Actions استفاده می‌کند و نیازی به تنظیم رمز نیست.

## ۲) ساخت روی رایانه‌ی ویندوزی

پیش‌نیازها:

- **Node.js 20+** (فقط برای ساخت بسته — کاربر نهایی نیازی به آن ندارد)
- **Inno Setup 6** برای ساخت فایل نصب: `winget install JRSoftware.InnoSetup`
  (اگر نصب نباشد، فقط ZIP قابل‌حمل ساخته می‌شود)

```powershell
# در ریشه‌ی مخزن
powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1 -Version 1.0.0 -AutoInstallInno
```

گزینه‌های مفید:

| پارامتر | کاربرد |
|---|---|
| `-Version 1.2.0` | نسخه‌ی بسته (در نام فایل‌ها) |
| `-NodeVersion v24.10.0` | نسخه‌ی Node.js همراه بسته (پیش‌فرض: آخرین LTS) |
| `-Installer:$false` | فقط ساخت ZIP قابل‌حمل |
| `-Portable:$false` | فقط ساخت نصب‌کننده |
| `-SkipChecks` | رد کردن lint/typecheck/test (در CI استفاده می‌شود) |
| `-VerifyPackage:$false` | رد کردن آزمون اجرای موقت سرور |
| `-Publish` | انتشار خودکار در GitHub Releases (نیازمند `gh` وارد‌شده) |

خروجی‌ها در `packaging/windows/dist/` ساخته می‌شوند.

---

## بسته شامل چه چیزهایی است؟

```
YouTubeDownloader/
├─ Start-YouTubeDownloader.cmd   اجرای سرویس + باز کردن مرورگر
├─ Stop-YouTubeDownloader.cmd    توقف سرویس و بستن فرایندهای yt-dlp/ffmpeg
├─ Update-yt-dlp.cmd             به‌روزرسانی yt-dlp به آخرین نسخه
├─ runner.mjs                    لانچر (انتخاب پورت آزاد، لاگ، باز کردن مرورگر)
├─ .env.example                  تنظیمات (پورت، کوکی، پراکسی، پوشه‌ی دانلود…)
├─ README.txt                    راهنمای فارسی کاربر نهایی
├─ next.config.mjs               پیکربندی زمان اجرا (کامپایل‌شده از next.config.ts)
├─ node_modules/ · .next/ · public/   خود برنامه
├─ runtime/node.exe              Node.js ویندوز (بدون نیاز به نصب روی سیستم کاربر)
├─ tools/yt-dlp.exe              موتور دانلود
├─ tools/ffmpeg.exe              ادغام ویدئو/صدا و تبدیل MP3
└─ data/                         downloads · cache · logs  (ایجاد در زمان اجرا)
```

نکته‌های فنی مهم در فرایند ساخت:

- **وابستگی‌ها فقط production** نصب می‌شوند و بسته‌های غیرضروری برای ویندوز
  (`@next/swc-*` و `sharp`/`@img`) حذف می‌شوند؛ این کار حجم نصب را حدود **۲۵۰ مگابایت** کم می‌کند
  (بررسی شده: سرور بسته‌بندی‌شده بدون این بسته‌ها کامل کار می‌کند).
- **`next.config.ts` در زمان ساخت به `next.config.mjs` کامپایل می‌شود** تا سرور در زمان اجرا
  به TypeScript/SWC نیاز نداشته باشد و در اولین اجرا چیزی دانلود نکند.
- **آزمون خودکار بسته**: پیش از ساخت نصب‌کننده، سرور از داخل بسته به‌صورت موقت اجرا و
  پاسخ `/api/health` بررسی می‌شود؛ اگر بسته خراب باشد، ساخت متوقف می‌شود.
- **آیکون نصب‌کننده** با `tools/make-icon.mjs` (بدون وابستگی خارجی) تولید می‌شود؛
  خروجی `assets/app.ico` با اندازه‌های ۱۶ تا ۲۵۶ پیکسل است.
- سرور فقط روی `127.0.0.1` گوش می‌دهد؛ بنابراین **هیچ هشدار فایروال ویندوزی** نمایش داده نمی‌شود
  و برنامه از بیرون قابل دسترسی نیست.

## نکته‌های کاربر نهایی

- فایل نصب امضای دیجیتال (Code Signing) ندارد؛ ویندوز ممکن است پیام
  «Windows protected your PC» نشان دهد → **More info → Run anyway**.
  برای امضای رسمی، یک گواهی EV/OV تهیه کنید و با `signtool` فایل `Setup.exe` را امضا کنید.
- برنامه بدون دیتابیس هم کار می‌کند؛ برای فعال‌کردن تاریخچه، `DATABASE_URL` را در `.env` بگذارید.
- برای عبور از خطای «Sign in to confirm you're not a bot» مقدار `YTDLP_COOKIES_FILE` را در `.env`
  به فایل کوکی مرورگر (فرمت Netscape) تنظیم کنید.

## عیب‌یابی ساخت

| مشکل | راه‌حل |
|---|---|
| `Inno Setup پیدا نشد` | `winget install JRSoftware.InnoSetup` یا اجرای اسکریپت با `-AutoInstallInno` |
| گیر کردن در دانلود Node.js | از پروکسی/شبکه‌ی دیگر استفاده کنید یا `-NodeVersion` را با نسخه‌ای که دارید تنظیم کنید |
| خطای «yt-dlp.exe دریافت نشد» | فایل را دستی دانلود و در `packaging/windows/assets/yt-dlp.exe` قرار دهید |
| خطای ffmpeg از npm | فایل `ffmpeg.exe` را دستی در `packaging/windows/assets/ffmpeg.exe` قرار دهید |
| خطای طول مسیر در ویندوز | مخزن را در مسیر کوتاه (مثل `C:\src\yt`) کلون کنید |
