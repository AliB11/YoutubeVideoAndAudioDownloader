import path from "node:path";

/** کاراکترهای کنترلی، کاراکترهای جهت‌دهی متن (RTL/LTR override) و کاراکترهای غیرمجاز فایل‌سیستم */
const ILLEGAL_CHARS = /[\\/:*?"<>|]/g;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** نام‌های رزرو‌شده‌ی ویندوز که نمی‌توانند نام فایل باشند */
const WINDOWS_RESERVED = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * پاک‌سازی نام فایل خروجی.
 *
 * - کاراکترهای غیرمجاز در ویندوز/لینوکس و کاراکترهای کنترلی حذف می‌شوند
 *   (کاراکترهای RTL/LTR override هم حذف می‌شوند تا پسوند فایل پنهان/جعل نشود).
 * - نام‌های رزرو‌شده‌ی ویندوز (CON، PRN، …) پیشوند می‌گیرند.
 * - نقطه/فاصله‌ی ابتدا و انتها حذف می‌شود و طول نهایی محدود می‌شود.
 */
export function sanitizeFileName(name: string, maxLength = 120): string {
  let out = (name ?? "")
    .replace(CONTROL_OR_BIDI, "")
    .replace(ILLEGAL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");

  if (!out) return "download";
  if (WINDOWS_RESERVED.has(out.toLowerCase())) out = `_${out}`;

  const chars = [...out];
  if (chars.length > maxLength) {
    out = chars.slice(0, maxLength).join("").trim();
    if (!out) return "download";
  }
  return out;
}

/** پسوندهای جانبی که خروجی نهایی محسوب نمی‌شوند */
const SIDECAR_RE = /\.(part|ytdl|temp|webp|jpg|jpeg|png|txt|json|description|info\.json)$/i;

/**
 * انتخاب فایل خروجی نهایی از میان فایل‌های پوشه‌ی یک job.
 *
 * مهم: در دانلودهای ادغامی، yt-dlp ابتدا فایل‌های موقت مثل `output.f137.mp4` را
 * می‌سازد و سپس آن‌ها را در `output.mp4` ادغام و حذف می‌کند؛ پس اولویت همیشه با
 * نام دقیق `output.<ext>` است تا فایل نیم‌کاره اشتباهی ارسال نشود.
 */
export function pickOutputFile(files: string[], kind: "video" | "audio"): string | null {
  const wanted = kind === "video" ? "mp4" : "mp3";
  const candidates = files.filter((f) => !SIDECAR_RE.test(f) && !f.startsWith("."));

  return (
    candidates.find((f) => f.toLowerCase() === `output.${wanted}`) ??
    candidates.find((f) => f.toLowerCase().endsWith(`.${wanted}`)) ??
    candidates.find((f) => f.toLowerCase().startsWith("output.")) ??
    candidates.find((f) => !/\.f\d+\./i.test(f)) ??
    null
  );
}

export interface ParsedRange {
  start: number;
  end: number;
  status: 200 | 206;
}

/**
 * تجزیه‌ی هدر `Range` برای پشتیبانی از دانلود قابل‌ادامه.
 * در صورت نامعتبر بودن یا غیرقابل‌ارضا بودن، `"invalid"` یا `"unsatisfiable"` برمی‌گردد.
 */
export function parseRangeHeader(
  range: string | null | undefined,
  total: number,
): ParsedRange | "unsatisfiable" | null {
  if (!range || total <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (!m[1] && !m[2])) return null;

  let start = m[1] ? Number.parseInt(m[1], 10) : Number.NaN;
  let end = m[2] ? Number.parseInt(m[2], 10) : Number.NaN;

  if (!m[1] && m[2]) {
    // بازه‌ی پسوندی: `bytes=-500` یعنی ۵۰۰ بایت آخر
    const suffix = Number.parseInt(m[2], 10);
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else if (m[1] && !m[2]) {
    end = total - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= total || start < 0 || end < start) return "unsatisfiable";
  return { start, end: Math.min(end, total - 1), status: 206 };
}

/** هدر `Content-Disposition` با پشتیبانی از نام فایل فارسی (RFC 5987) */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "'");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * بررسی می‌کند که مسیر `child` واقعاً داخل `parent` است (جلوگیری از path traversal
 * در صورتی که مسیر فایل از دیتابیس/ورودی کاربر بیاید).
 */
export function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** آیا مقدار داده‌شده یک آدرس http/https معتبر است؟ */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
