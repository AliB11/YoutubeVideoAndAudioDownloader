/**
 * ساخت آرگومان‌های yt-dlp و ترجمه‌ی خطاهای آن.
 *
 * این ماژول «خالص» است تا بدون اجرای واقعی yt-dlp قابل تست باشد؛ تنها کاری که می‌کند
 * تبدیل تنظیمات ورودی به آرایه‌ی آرگومان و تبدیل متن خطا به پیام فارسی است.
 */

/** بیت‌ریت‌های مجاز MP3 — تنها منبع حقیقت در کل پروژه (API و رابط کاربری از همین استفاده می‌کنند) */
export const AUDIO_BITRATES = [320, 256, 192, 160, 128, 96, 64] as const;

export type DownloadKind = "video" | "audio";

export interface YtDlpCapabilities {
  /** مسیر/نسخه‌ی باینری (فقط برای نمایش در گزارش وضعیت) */
  version: string | null;
  /** آرگومان `--js-runtimes` پشتیبانی می‌شود؟ (نسخه‌های جدید yt-dlp) */
  supportsJsRuntimes: boolean;
  /** آرگومان `--remote-components` پشتیبانی می‌شود؟ */
  supportsRemoteComponents: boolean;
  /** باینری مستقل (standalone) است؟ باینری‌های pip برای حل چالش JS به yt-dlp-ejs نیاز دارند. */
  isSelfContained: boolean;
}

export interface CommonArgsInput {
  capabilities: YtDlpCapabilities;
  /** مسیر اجراکننده‌ی Node (برای `--js-runtimes node:<path>`) */
  nodePath: string;
  ffmpegPath: string | null;
  cookiesFile?: string | null;
  proxy?: string | null;
  extraArgs?: string | null;
  /** مسیر پوشه‌ی فایل‌های موقت (برای cache و part) */
  cacheDir?: string | null;
  /** آرگومان‌های اضافی remote-components؛ خالی یعنی اضافه نشود */
  remoteComponents?: string | null;
}

/** آرگومان‌های مشترک همه‌ی فراخوانی‌های yt-dlp */
export function buildCommonArgs(input: CommonArgsInput): string[] {
  const args = ["--no-playlist", "--no-warnings", "--no-mtime", "--ignore-config"];

  if (input.ffmpegPath) args.push("--ffmpeg-location", input.ffmpegPath);
  if (input.cacheDir) args.push("--cache-dir", input.cacheDir);

  if (input.capabilities.supportsJsRuntimes && input.nodePath) {
    // yt-dlp برای حل چالش‌های JS یوتیوب به یک runtime نیاز دارد؛ Node همیشه در دسترس است.
    args.push("--js-runtimes", `node:${input.nodePath}`);
  }

  if (input.capabilities.supportsRemoteComponents && input.remoteComponents) {
    // باینری‌های رسمی، ماژول چالش را همراه دارند؛ نصب‌های pip به دانلود از راه دور نیاز دارند.
    args.push("--remote-components", input.remoteComponents);
  }

  if (input.cookiesFile) args.push("--cookies", input.cookiesFile);
  if (input.proxy) args.push("--proxy", input.proxy);
  if (input.extraArgs) args.push(...input.extraArgs.split(/\s+/).filter(Boolean));

  return args;
}

/**
 * انتخاب زنجیره‌ی فرمت برای دانلود ویدئو با ارتفاع مشخص.
 * اولویت: H.264 داخل mp4 (سازگاری بالا) → هر mp4 → هر ویدئوی تنها + صدا → فرمت ترکیبی → بهترین موجود.
 */
export function buildVideoFormatSelector(height: number): string {
  const h = Math.max(144, Math.floor(height));
  return [
    `bestvideo[height<=${h}][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=${h}][ext=mp4][vcodec^=avc1]+bestaudio`,
    `bestvideo[height<=${h}][ext=mp4][vcodec~='^(avc|hvc|hev|av01)']+bestaudio[ext=m4a]/best[height<=${h}][ext=mp4]`,
    `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio`,
    `best[height<=${h}][ext=mp4]/best[height<=${h}]`,
    "best",
  ].join("/");
}

/**
 * آرگومان‌های بخش دانلود (به‌جز آرگومان‌های مشترک و آدرس).
 * `outTemplate` الگوی مسیر خروجی، مثل `/tmp/job/output.%(ext)s`.
 */
export function buildDownloadArgs(opts: {
  kind: DownloadKind;
  quality: number;
  outTemplate: string;
}): string[] {
  const args = ["--newline", "--progress", "-o", opts.outTemplate];

  if (opts.kind === "video") {
    args.push(
      "-f",
      buildVideoFormatSelector(opts.quality),
      "--merge-output-format",
      "mp4",
      // سازگاری با پخش‌کننده‌های تحت وب (فایل بلافاصله قابل پخش باشد)
      "--postprocessor-args",
      "Merger:-movflags +faststart",
    );
  } else {
    const bitrate = Math.min(320, Math.max(64, Math.floor(opts.quality)));
    args.push(
      "-f",
      "bestaudio[ext=m4a]/bestaudio/best",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      `${bitrate}K`,
      "--embed-thumbnail",
      "--convert-thumbnails",
      "jpg",
      "--add-metadata",
      "--embed-metadata",
    );
  }

  return args;
}

/**
 * حذف پیشوندهای تکراری خطای yt-dlp، مثل:
 * `ERROR: [youtube] dQw4w9WgXcQ: Video unavailable`
 */
export function cleanYtDlpError(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const errorLines = lines.filter((l) => /^ERROR:/.test(l));
  if (errorLines.length === 0) {
    // خطای مشخصی در stderr نبود؛ آخرین خط را همان‌طور که هست برگردان می‌کنیم.
    return (lines[lines.length - 1] ?? "").slice(0, 400);
  }

  return errorLines[errorLines.length - 1]
    .replace(/^ERROR:\s*/, "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/^[\w-]+:\s*/, "")
    .trim()
    .slice(0, 400);
}

interface ErrorRule {
  test: RegExp;
  message: string;
}

/** خطاهای رایج yt-dlp → پیام فارسی همراه با راه‌حل عملی */
const ERROR_RULES: ErrorRule[] = [
  {
    test: /sign in to confirm (you'?re not a bot|your age)/i,
    message:
      "یوتیوب این درخواست را مشکوک تشخیص داده است. برای رفع آن فایل کوکی مرورگر را تنظیم کنید (YTDLP_COOKIES_FILE) یا از پراکسی استفاده کنید.",
  },
  {
    test: /(nsig|signature|js challenge|solve.*challenge|ejs)/i,
    message:
      "حل چالش جاوااسکریپت یوتیوب ناموفق بود. نسخه‌ی yt-dlp را به‌روزرسانی کنید یا باینری رسمی را در YTDLP_PATH قرار دهید.",
  },
  {
    test: /this (live event|video) (has ended|will begin)|premieres in|is not yet available|live stream recording/i,
    message: "این مورد پخش زنده/پریمیر است و در حال حاضر قابل دانلود نیست.",
  },
  {
    test: /video unavailable|this video is unavailable|removed by the uploader|no longer available/i,
    message: "ویدئو در دسترس نیست (حذف شده یا خصوصی است).",
  },
  {
    test: /private video|this video is private/i,
    message: "این ویدئو خصوصی است و بدون کوکی حساب صاحب آن قابل دانلود نیست.",
  },
  {
    test: /members[- ]only|join this channel|channel'?s members/i,
    message: "این ویدئو مخصوص اعضای کانال است و با کوکی حساب عضو قابل دانلود است.",
  },
  {
    test: /not available in your country|blocked in your country|geo[- ]?restrict/i,
    message: "این ویدئو در منطقه‌ی جغرافیایی سرور شما قابل دسترسی نیست (محدودیت منطقه‌ای).",
  },
  {
    test: /requested format is not available/i,
    message: "کیفیت انتخاب‌شده برای این ویدئو موجود نیست؛ کیفیت دیگری را امتحان کنید.",
  },
  {
    test: /http error 403|unable to download (video data|webpage).*403/i,
    message: "یوتیوب دسترسی به فایل را رد کرد (۴۰۳). لطفاً چند لحظه بعد دوباره تلاش کنید.",
  },
  {
    test: /http error 429|too many requests/i,
    message: "تعداد درخواست‌ها زیاد است و یوتیوب موقتاً محدود کرده است؛ کمی صبر کنید.",
  },
  {
    test: /unsupported url|is not a valid url/i,
    message: "آدرس وارد‌شده یک صفحه‌ی ویدئویی یوتیوب نیست.",
  },
  {
    test: /ffmpeg (not found|is not installed)|you have requested merging|postprocessing/i,
    message: "ffmpeg در دسترس نیست؛ برای ادغام ویدئو/صدا و ساخت MP3 نصب آن الزامی است.",
  },
  {
    test: /unable to download webpage|connection (refused|reset|timed out)|timed out|temporary failure in name resolution|network is unreachable/i,
    message: "ارتباط با یوتیوب برقرار نشد (شبکه/فیلترینگ). تنظیم YTDLP_PROXY می‌تواند کمک کند.",
  },
  {
    test: /this video is only available for (premium|music premium)/i,
    message: "این ویدئو فقط برای کاربران پریمیوم قابل دسترسی است.",
  },
  {
    test: /no space left on device|disk quota/i,
    message: "فضای دیسک سرور پر شده است؛ فایل‌های قدیمی پاک می‌شوند یا فضای بیشتری لازم است.",
  },
  {
    test: /permission denied|eacces/i,
    message: "سرور به مسیر فایل‌ها دسترسی نوشتن ندارد (بررسی کنید مسیر موقت قابل نوشتن باشد).",
  },
];

/**
 * تبدیل خطای خام yt-dlp به پیام فارسیِ قابل‌فهم؛ اگر الگوی شناخته‌شده‌ای نبود،
 * متن اصلی (کوتاه‌شده) برگردانده می‌شود تا اطلاعات برای عیب‌یابی از دست نرود.
 */
export function mapYtDlpError(rawError: string): string {
  const cleaned = cleanYtDlpError(rawError) || rawError.trim();
  for (const rule of ERROR_RULES) {
    if (rule.test.test(cleaned) || rule.test.test(rawError)) {
      return rule.message;
    }
  }
  return cleaned.slice(0, 300) || "خطای ناشناخته در ارتباط با yt-dlp";
}
