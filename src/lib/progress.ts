/**
 * تجزیه‌ی خروجی yt-dlp و تبدیل آن به «پیشرفت کلی» یک دانلود.
 *
 * این ماژول کاملاً خالص (pure) است؛ نه فرایندی اجرا می‌کند و نه به دیسک/شبکه وابسته است،
 * بنابراین به‌راحتی تست می‌شود (به `tests/progress.test.ts` نگاه کنید).
 *
 * نمونه خطوط واقعی yt-dlp:
 *   [info] dQw4w9WgXcQ: Downloading 1 format(s): 137+140
 *   [download] Destination: /tmp/job/output.f137.mp4
 *   [download]  42.3% of  102.40MiB at   5.21MiB/s ETA 00:11
 *   [download] 100% of  102.40MiB in 00:20 at 5.01MiB/s
 *   [Merger] Merging formats into "/tmp/job/output.mp4"
 */

export type DownloadPhase = "downloading" | "processing";

export interface ProgressMetrics {
  /** درصد پیشرفت کل (۰ تا ۱۰۰، عدد صحیح) */
  percent: number;
  /** مرحله‌ی فعلی */
  phase: DownloadPhase;
  /** سرعت لحظه‌ای، مثل «5.21MiB/s» */
  speed?: string;
  /** زمان تخمینی باقی‌مانده، مثل «00:11» */
  eta?: string;
  /** بایت‌های دانلودشده */
  downloadedBytes?: number;
  /** حجم کل دانلود */
  totalBytes?: number;
}

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
};

const SIZE_UNIT_MULTIPLIER: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5 };

/**
 * تبدیل اندازه‌های yt-dlp (مثل `102.40MiB` یا `1.5GiB`) به بایت.
 * مقدار نامشخص/نامعتبر → `undefined`.
 */
export function parseYtDlpSize(input: string | undefined | null): number | undefined {
  if (!input) return undefined;
  const m = /([\d.]+)\s*([KMGTP]?i?B)/i.exec(input.trim());
  if (!m) return undefined;
  const value = Number.parseFloat(m[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = SIZE_UNITS[m[2].toUpperCase()];
  if (!unit) return undefined;
  return Math.round(value * unit);
}

/** تبدیل رشته‌ی سرعت yt-dlp به بایت بر ثانیه (مثل `5.21MiB/s` → عدد) */
export function parseYtDlpSpeed(input: string | undefined | null): number | undefined {
  if (!input) return undefined;
  const m = /([\d.]+)\s*([KMGTP]?)(?:i?B)\/s/i.exec(input);
  if (!m) return undefined;
  const value = Number.parseFloat(m[1]);
  if (!Number.isFinite(value)) return undefined;
  const mult = SIZE_UNIT_MULTIPLIER[m[2].toUpperCase()] ?? 1;
  return Math.round(value * mult);
}

/** آیا رشته‌ی ETA معتبر است؟ (مثل `00:11` یا `01:02:03`) */
export function isValidEta(input: string | undefined | null): boolean {
  return !!input && /^\d{1,2}(:\d{2}){1,2}$/.test(input.trim());
}

/**
 * تعداد استریم‌هایی که yt-dlp قرار است دانلود کند را از خط
 * `[info] … Downloading 1 format(s): 137+140` استخراج می‌کند.
 *
 * نکته‌ی مهم: خودِ yt-dlp همیشه «1 format(s)» می‌نویسد، حتی وقتی دو استریم
 * (ویدئو + صدا) جدا دانلود می‌شوند؛ پس باید خودِ فهرست فرمت‌ها شمرده شود.
 */
export function parseFormatCount(line: string): number | null {
  const m = /Downloading\s+(\d+)\s+format\(s?\):\s*(\S+)/.exec(line);
  if (!m) return null;
  const list = m[2];
  // فرمت‌هایی مثل `137+140` یا `243+251` دو استریم جدا هستند.
  const ids = list.split("+").filter((part) => /\w/.test(part));
  return Math.max(1, ids.length);
}

/** آیا خط مربوط به مرحله‌ی پس‌پردازش (ادغام/تبدیل/متادیتا) است؟ */
const POSTPROCESS_RE =
  /^\[(merger|extractaudio|videoconvertor|audioconvertor|thumbnailsconvertor|metadataparser|embedthumbnail|fixup\w*|ffmpeg|moviefiles|movefiles|sponsorblock|chapter|modifychapters)\]/i;

export function isPostProcessLine(line: string): boolean {
  return POSTPROCESS_RE.test(line.trim());
}

interface LineUpdate extends ProgressMetrics {}

/**
 * ردیاب پیشرفت یک دانلود. برای هر خط خروجی yt-dlp یک‌بار `handleLine` صدا زده می‌شود
 * و مقدار برگشتی، «وضعیت جدید» است (یا `null` اگر تغییری رخ نداده باشد).
 */
export class DownloadProgressTracker {
  private readonly kind: "video" | "audio";
  /** تعداد کل استریم‌ها */
  private phases: number;
  /** شماره‌ی استریمی که در حال دانلود است (از ۰) */
  private phaseIndex = 0;
  /** آخرین درصد اعلام‌شده برای استریم جاری */
  private currentPercent = 0;
  /** درصد نزدیک‌ترین «کف» مرحله‌ی پس‌پردازش */
  private processingPercent: number;
  private processingTouched = false;
  private last: ProgressMetrics;

  constructor(kind: "video" | "audio") {
    this.kind = kind;
    // برای ویدئو معمولاً یک استریم ویدئو + یک استریم صدا ادغام می‌شود؛ اگر خط `[info]`
    // چیزی دیگری بگوید همان لحظه اصلاح می‌شود.
    this.phases = kind === "video" ? 2 : 1;
    this.processingPercent = kind === "video" ? 95 : 90;
    this.last = { percent: 0, phase: "downloading" };
  }

  /**
   * خطوطی که ظرفیت دارند: خط `[info]` (تعیین تعداد استریم)، خطوط `[download]`،
   * خطوط پس‌پردازش.
   */
  handleLine(rawLine: string): LineUpdate | null {
    const line = rawLine.trim();
    if (!line) return null;

    const formats = parseFormatCount(line);
    if (formats !== null) {
      this.phases = formats;
      return null;
    }

    if (/^\[download\]\s+Destination:/i.test(line)) {
      // شروع دانلود یک استریم جدید
      if (/f\d+/.test(line) && this.phases === 1 && this.kind === "video") {
        // خروجی مثل output.f137.mp4 یعنی استریم‌ها جدا هستند
        this.phases = 2;
      }
      const bucket = Math.round((this.phaseIndex / this.phases) * this.downloadCeiling());
      if (bucket > this.last.percent) {
        return this.emit({ percent: bucket, phase: "downloading" });
      }
      return null;
    }

    const download = this.handleDownloadLine(line);
    if (download) return download;

    if (/has already been downloaded/i.test(line) || /^\[download\]\s+100%/.test(line)) {
      this.phaseIndex = Math.min(this.phaseIndex + 1, Math.max(0, this.phases - 1));
      this.currentPercent = 100;
      return this.emit({ percent: this.downloadCeiling(), phase: "downloading" });
    }

    if (isPostProcessLine(line)) {
      const step = this.kind === "video" ? 1 : 2;
      this.processingPercent = this.processingTouched
        ? Math.min(99, this.processingPercent + step)
        : this.processingPercent;
      this.processingTouched = true;
      const percent = Math.max(this.last.percent, this.processingPercent);
      if (percent === this.last.percent && this.last.phase === "processing") return null;
      return this.emit({ percent, phase: "processing" });
    }

    return null;
  }

  /** سقف پیشرفت در مرحله‌ی دانلود؛ بقیه‌ی درصد برای ادغام/تبدیل نگه داشته می‌شود */
  private downloadCeiling(): number {
    return this.kind === "video" ? 95 : 90;
  }

  private handleDownloadLine(line: string): LineUpdate | null {
    const percentMatch = /^\[download\]\s+([\d.]+)%\s+of\s+(~?\s*[\d.]+\s*[KMGTP]?i?B)/i.exec(line);
    if (!percentMatch) return null;

    const rawPercent = Number.parseFloat(percentMatch[1]);
    if (!Number.isFinite(rawPercent)) return null;
    this.currentPercent = Math.min(100, rawPercent);

    const totalBytes = parseYtDlpSize(percentMatch[2]);
    const speedMatch = /\bat\s+([\d.]+\s*[KMGTP]?i?B\/s)/i.exec(line);
    const etaMatch = /\bETA\s+([0-9:]+)/i.exec(line);

    const phaseFraction = this.phases > 0 ? this.currentPercent / 100 / this.phases : 1;
    const doneFraction = this.phases > 0 ? this.phaseIndex / this.phases : 1;
    const percent = Math.min(
      this.downloadCeiling(),
      Math.max(this.last.percent, Math.round((doneFraction + phaseFraction) * this.downloadCeiling())),
    );

    return this.emit({
      percent,
      phase: "downloading",
      speed: speedMatch ? speedMatch[1].replace(/\s+/g, "") : undefined,
      eta: etaMatch && isValidEta(etaMatch[1]) ? etaMatch[1] : undefined,
      totalBytes,
      downloadedBytes: totalBytes != null ? Math.round((totalBytes * this.currentPercent) / 100) : undefined,
    });
  }

  private emit(update: Omit<LineUpdate, "percent"> & { percent: number }): LineUpdate | null {
    const next: ProgressMetrics = {
      percent: update.percent,
      phase: update.phase,
      speed: update.speed ?? this.last.speed,
      eta: update.eta ?? this.last.eta,
      totalBytes: update.totalBytes ?? this.last.totalBytes,
      downloadedBytes: update.downloadedBytes ?? this.last.downloadedBytes,
    };
    const unchanged =
      next.percent === this.last.percent &&
      next.phase === this.last.phase &&
      next.speed === this.last.speed &&
      next.eta === this.last.eta &&
      next.downloadedBytes === this.last.downloadedBytes;
    this.last = next;
    return unchanged ? null : next;
  }
}
