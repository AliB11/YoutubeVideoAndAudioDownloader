/**
 * محدودکننده‌ی نرخ درخواست (in-memory).
 *
 * هدف: جلوگیری از سوءاستفاده از اندپوینت‌های سنگین (هر درخواست اطلاعات/دانلود
 * یک فرایند yt-dlp اجرا می‌کند). مقدار پیش‌فرض سخاوتمندانه است و با متغیر محیطی
 * `RATE_LIMIT_PER_MINUTE` قابل تنظیم (یا با مقدار 0 غیرفعال) می‌شود.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastPrune = 0;

function prune(now: number) {
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** ثانیه تا آزاد شدن سهمیه */
  retryAfter: number;
}

/**
 * بررسی سهمیه‌ی یک کلید (معمولاً IP). `limit = 0` یعنی محدودیت غیرفعال است.
 */
export function checkRateLimit(key: string, limit: number, windowMs = 60_000): RateLimitResult {
  if (!limit || limit <= 0) return { ok: true, retryAfter: 0 };
  const now = Date.now();
  prune(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { ok: true, retryAfter: 0 };
}

/** استخراج IP کاربر از هدرها (پشت پروکسی هم کار می‌کند) */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "local";
}

/** سقف مجاز درخواست در دقیقه (پیش‌فرض: ۳۰؛ صفر = بدون محدودیت) */
export const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 30);
