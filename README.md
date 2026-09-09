# 🎬 یوتیوب دانلودر (YouTube Downloader)

وب‌اپلیکیشن دانلود ویدئو و MP3 از یوتیوب — ساخته‌شده با **Next.js 16 (App Router)**، **PostgreSQL + Drizzle ORM**، **yt-dlp** و **ffmpeg**.

[![CI](https://github.com/AliB11/YoutubeVideoAndAudioDownloader/actions/workflows/ci.yml/badge.svg)](https://github.com/AliB11/YoutubeVideoAndAudioDownloader/actions/workflows/ci.yml)

## ✨ امکانات

| بخش | توضیح |
|---|---|
| 🎬 **دانلود ویدئو** | آدرس ویدئو را بدهید؛ تمام کیفیت‌های موجود (144p تا 4K/60fps) با حجم تقریبی لیست می‌شود و با یک کلیک به‌صورت **MP4** (ویدئو + صدا ادغام‌شده، H.264) دانلود می‌شود. |
| 🎵 **دانلود MP3** | همان آدرس را بدهید؛ کیفیت‌های MP3 (**320 / 256 / 192 / 160 / 128 / 96 / 64 kbps**) لیست می‌شود و فایل MP3 همراه با کاور و متادیتا ساخته و دانلود می‌شود. |
| 📊 **پیشرفت لحظه‌ای** | نوار پیشرفت زنده برای مراحل دانلود از یوتیوب، ادغام ویدئو/صدا و تبدیل به MP3. |
| 🗂 **تاریخچه** | تمام دانلودها در PostgreSQL ذخیره می‌شوند و تا زمان انقضا قابل دانلود مجدد هستند. |
| ⏹ **لغو و حذف** | دانلودِ در حال انجام را می‌توان متوقف (لغو) کرد و هر رکورد را از تاریخچه حذف کرد. |
| ⬇ **دانلود قابل ادامه** | پشتیبانی از `Range` (Resume در دانلود منیجرها). |
| 🧹 **پاک‌سازی خودکار** | فایل‌های موقت پس از مدت مشخص (پیش‌فرض ۲ ساعت) از سرور حذف می‌شوند. |
| 🌐 **فارسی و RTL** | رابط کاربری کاملاً فارسی با فونت وزیرمتن (به‌صورت self-host، بدون وابستگی به گوگل‌فونت). |
| 🔌 **بدون دیتابیس هم کار می‌کند** | اگر `DATABASE_URL` تنظیم نشود، دانلود و تبدیل همچنان فعال است؛ فقط تاریخچه ذخیره نمی‌شود. |

> ⚠️ این ابزار برای دانلود محتوایی است که حق استفاده از آن را دارید (ویدئوهای خودتان، محتوای با مجوز Creative Commons و…). لطفاً به حقوق پدیدآورندگان و قوانین یوتیوب احترام بگذارید.

---

## 🚀 اجرا با Docker (پیشنهادی)

```bash
git clone https://github.com/AliB11/YoutubeVideoAndAudioDownloader.git
cd YoutubeVideoAndAudioDownloader
docker compose up -d --build
```

سپس به `http://localhost:3000` بروید. دیتابیس، yt-dlp و ffmpeg همه داخل کانتینر آماده‌اند.

## 🛠 اجرای محلی (بدون Docker)

پیش‌نیاز: Node.js 20+ (PostgreSQL اختیاری است — فقط برای تاریخچه)

```bash
cp .env.example .env         # DATABASE_URL را تنظیم کنید (اختیاری)
npm install
npx drizzle-kit push         # ساخت جدول‌ها (فقط اگر دیتابیس دارید)
npm run dev                  # http://localhost:3000
```

- **yt-dlp**: در اولین درخواست به‌صورت خودکار از ریلیز رسمی GitHub دانلود و در پوشه `.bin/` ذخیره می‌شود (یا `YTDLP_PATH` را تنظیم کنید).
- **ffmpeg**: از پکیج `ffmpeg-static` استفاده می‌شود (یا `FFMPEG_PATH` را تنظیم کنید).
- بدون `DATABASE_URL` نیز اپلیکیشن کار می‌کند؛ فقط بخش «تاریخچه» غیرفعال است.

### بیلد production

```bash
npm run build
npm run start
```

---

## ☁️ استقرار (Deploy)

اپلیکیشن به یک **سرور** نیاز دارد (اجرای yt-dlp/ffmpeg در پس‌زمینه)، پس روی هاست استاتیک اجرا نمی‌شود. هر کدام از این‌ها کار می‌کند:

- **هر VPS / سرور مجازی با داکر:** `git clone` + `docker compose up -d --build` (ساده‌ترین).
- **Railway / Render / Fly.io:** سرویس «Dockerfile» بسازید و `DATABASE_URL` را ست کنید (PostgreSQL داخلی همین پلتفرم‌ها کافی است).
- **بدون دیتابیس هم بالا می‌آید:** فقط تاریخچه ذخیره نمی‌شود.

> برای استقرار عمومی، حتماً یک لایهٔ احراز هویت/محدودیت نرخ اضافه کنید (فعلاً پروژه برای استفادهٔ شخصی طراحی شده است).

## ⚙️ متغیرهای محیطی| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `DATABASE_URL` | — | رشته اتصال PostgreSQL (الزامی) |
| `YTDLP_PATH` | دانلود خودکار | مسیر باینری yt-dlp |
| `FFMPEG_PATH` | `ffmpeg-static` | مسیر ffmpeg |
| `YTDLP_COOKIES_FILE` | — | فایل کوکی (Netscape) برای عبور از «Sign in to confirm you're not a bot» روی سرورهای دیتاسنتر |
| `YTDLP_PROXY` | — | پراکسی، مثلاً `socks5://127.0.0.1:1080` |
| `YTDLP_EXTRA_ARGS` | — | آرگومان‌های اضافی yt-dlp |
| `FILE_TTL_MINUTES` | `120` | مدت نگهداری فایل‌ها روی سرور |

### 🔑 رفع خطای «Sign in to confirm you're not a bot»
یوتیوب گاهی IP سرورها را محدود می‌کند. راه‌حل:
1. افزونه‌ی *Get cookies.txt LOCALLY* را روی مرورگر نصب کنید و در حالی که وارد یوتیوب هستید، کوکی‌ها را export کنید.
2. فایل را کنار پروژه بگذارید و `YTDLP_COOKIES_FILE=/app/cookies.txt` را تنظیم کنید (در `docker-compose.yml` خطوط مربوطه را از حالت کامنت خارج کنید).

---

## 🧩 معماری

```
src/
├─ app/
│  ├─ page.tsx                     # صفحه اصلی
│  ├─ layout.tsx                   # RTL + فونت فارسی (self-host)
│  ├─ preview/page.tsx             # پیش‌نمایش طراحی با دادهٔ نمایشی
│  └─ api/
│     ├─ info/route.ts             # POST  دریافت اطلاعات و کیفیت‌های ویدئو
│     ├─ jobs/route.ts             # GET تاریخچه | POST ایجاد job دانلود
│     ├─ jobs/[jobId]/route.ts     # GET وضعیت/پیشرفت job | DELETE حذف یا لغو (?cancel=1)
│     └─ jobs/[jobId]/file/route.ts# GET استریم فایل نهایی (با Range)
├─ components/
│  ├─ downloader.tsx               # رابط کاربری (تب ویدئو / MP3، لغو، حذف)
│  └─ hero.tsx                     # سربرگ صفحه
├─ lib/
│  ├─ ytdlp.ts                     # مدیریت باینری، parse فرمت‌ها، اجرا/لغو دانلود
│  ├─ jobs.ts                      # مدیریت jobها + ذخیره در DB + پاک‌سازی
│  ├─ demo.ts                      # دادهٔ نمایشی برای حالت پیش‌نمایش
│  └─ format.ts                    # توابع فرمت‌بندی
└─ db/
   ├─ schema.ts                    # جدول downloads
   └─ index.ts                     # کلاینت Drizzle
drizzle.config.ts                  # پیکربندی drizzle-kit (خواندن DATABASE_URL از env)
```

### جریان کار
1. کاربر لینک را وارد می‌کند → `POST /api/info` → yt-dlp فرمت‌ها را می‌خواند و کیفیت‌ها گروه‌بندی می‌شوند.
2. کاربر کیفیت را انتخاب می‌کند → `POST /api/jobs` → رکورد در DB ثبت و yt-dlp در پس‌زمینه اجرا می‌شود.
3. کلاینت هر ثانیه `GET /api/jobs/:id` را poll می‌کند و نوار پیشرفت به‌روز می‌شود.
4. پس از اتمام، مرورگر خودکار `GET /api/jobs/:id/file` را باز می‌کند و فایل ذخیره می‌شود.
5. حین دانلود می‌توان `DELETE /api/jobs/:id?cancel=1` را صدا زد تا فرایند yt-dlp متوقف و وضعیت «لغو شده» ثبت شود؛ `DELETE /api/jobs/:id` رکورد را کامل از تاریخچه حذف می‌کند.

---

## 🤖 CI (بررسی خودکار روی GitHub)

فایل `.github/workflows/ci.yml` روی هر push و pull request، مراحل **lint → typecheck → build** را اجرا می‌کند تا مطمئن شویم پروژه همیشه قابل build است. برای اجرای محلی همین بررسی‌ها:

```bash
npm run lint
npm run typecheck
npm run build
```

## 📄 لایسنس
MIT
