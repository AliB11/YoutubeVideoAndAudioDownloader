import { spawn, type ChildProcess } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AUDIO_BITRATES,
  buildCommonArgs,
  buildDownloadArgs,
  cleanYtDlpError,
  mapYtDlpError,
  type DownloadKind,
} from "@/lib/ytdlp-args";
import { DownloadProgressTracker, type ProgressMetrics } from "@/lib/progress";
import { pickOutputFile, sanitizeFileName } from "@/lib/files";
import { demoBaseUrl, demoMediaUrl, ensureDemoMedia, isDemoMode } from "@/lib/demo-source";
import { getFfmpegPath, getYtDlpCapabilities, getYtDlpPath, runCapture, YTDLP_CACHE_DIR } from "@/lib/toolchain";

export { sanitizeFileName } from "@/lib/files";
export type { DownloadKind } from "@/lib/ytdlp-args";
export { AUDIO_BITRATES } from "@/lib/ytdlp-args";

/* -------------------------------------------------------------------------- */
/*                                  Config                                    */
/* -------------------------------------------------------------------------- */

/** ریشه‌ی فایل‌های دانلودشده (قابل تنظیم با DOWNLOAD_DIR — مفید برای مانت‌کردن volume) */
export const DOWNLOAD_ROOT =
  process.env.DOWNLOAD_DIR?.trim() || path.join(/* turbopackIgnore: true */ os.tmpdir(), "yt-downloader-jobs");

/** حداکثر زمان استخراج اطلاعات ویدئو (میلی‌ثانیه) */
const INFO_TIMEOUT_MS = Number(process.env.YTDLP_INFO_TIMEOUT_MS ?? 120_000);
/** مدت اعتبار کش اطلاعات ویدئو (برای جلوگیری از درخواست‌های تکراری به یوتیوب) */
const INFO_CACHE_TTL_MS = Number(process.env.INFO_CACHE_TTL_MS ?? 5 * 60 * 1000);

export function jobDir(jobId: string): string {
  return path.join(/* turbopackIgnore: true */ DOWNLOAD_ROOT, jobId.replace(/[^\w-]/g, ""));
}

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export interface VideoQuality {
  height: number;
  label: string; // "1080p" یا "1080p60"
  fps: number | null;
  ext: string;
  vcodec: string | null;
  filesize: number | null; // تخمین حجم (ویدئو + صدا)
  hasAudio: boolean;
}

export interface AudioQuality {
  bitrate: number;
  label: string; // "320 kbps"
  filesize: number | null;
  tag: string;
}

export interface VideoInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
  viewCount: number | null;
  webpageUrl: string;
  videoQualities: VideoQuality[];
  audioQualities: AudioQuality[];
  sourceAudioBitrate: number | null;
}

interface RawFormat {
  format_id: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  height?: number | null;
  width?: number | null;
  fps?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  abr?: number | null;
  tbr?: number | null;
  protocol?: string;
  format_note?: string;
}

interface RawInfo {
  id?: string;
  title?: string;
  thumbnail?: string;
  thumbnails?: { url: string }[];
  duration?: number;
  uploader?: string;
  channel?: string;
  view_count?: number;
  webpage_url?: string;
  formats?: RawFormat[];
  is_live?: boolean;
  live_status?: string;
  availability?: string;
  age_limit?: number;
}

/* -------------------------------------------------------------------------- */
/*                              URL validation                                */
/* -------------------------------------------------------------------------- */

const YOUTUBE_HOSTS = new Set(["youtube.com", "youtu.be", "youtube-nocookie.com"]);

/** آیا ورودی یک آدرس معتبر یوتیوب است؟ (پروتکل http/https و دامنه بررسی می‌شود) */
export function isValidYoutubeUrl(input: string): boolean {
  const value = (input ?? "").trim();
  if (!value || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  return YOUTUBE_HOSTS.has(host);
}

/** شناسه‌ی ویدئو از آدرس (برای کش، جلوگیری از دانلود تکراری و نمایش) */
export function extractVideoId(input: string): string | null {
  try {
    const url = new URL(input.trim());
    const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
    const valid = (id: string | null | undefined) => (id && /^[\w-]{6,20}$/.test(id) ? id : null);
    if (host === "youtu.be") return valid(url.pathname.slice(1).split("/")[0]);
    const v = url.searchParams.get("v");
    if (v) return valid(v);
    const match = /\/(?:shorts|embed|live|v)\/([\w-]{6,20})/.exec(url.pathname);
    return match ? valid(match[1]) : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                                Video info                                  */
/* -------------------------------------------------------------------------- */

const infoCache = new Map<string, { at: number; info: VideoInfo }>();

function readCache(key: string): VideoInfo | null {
  const hit = infoCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > INFO_CACHE_TTL_MS) {
    infoCache.delete(key);
    return null;
  }
  return hit.info;
}

function writeCache(key: string, info: VideoInfo) {
  if (infoCache.size > 100) infoCache.clear();
  infoCache.set(key, { at: Date.now(), info });
}

function audioTag(br: number): string {
  if (br >= 320) return "بالاترین کیفیت";
  if (br >= 192) return "کیفیت عالی";
  if (br >= 128) return "کیفیت استاندارد";
  return "حجم کم";
}

function buildAudioQualities(duration: number | null): AudioQuality[] {
  return AUDIO_BITRATES.map((bitrate) => ({
    bitrate,
    label: `${bitrate} kbps`,
    filesize: duration ? Math.round((bitrate * 1000 * duration) / 8) : null,
    tag: audioTag(bitrate),
  }));
}

function parseJsonOutput(raw: string): RawInfo {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("yt-dlp خروجی JSON معتبری برنگرداند");
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as RawInfo;
  } catch {
    throw new Error("تجزیه‌ی اطلاعات ویدئو ناموفق بود");
  }
}

/** اطلاعات ویدئو را از yt-dlp می‌خواند و کیفیت‌های موجود را استخراج می‌کند */
export async function fetchVideoInfo(url: string): Promise<VideoInfo> {
  const key = extractVideoId(url) ?? url;
  const cached = readCache(key);
  if (cached) return cached;

  if (isDemoMode()) {
    const { demoVideoInfo } = await import("@/lib/demo");
    const fixture: VideoInfo = {
      ...demoVideoInfo,
      id: extractVideoId(url) ?? demoVideoInfo.id,
      webpageUrl: url,
      // کاور واقعی: یک فریم از کلیپ نمونه که خود اپلیکیشن با ffmpeg می‌سازد
      thumbnail: demoMediaUrl(demoBaseUrl(), "thumbnail"),
    };
    writeCache(key, fixture);
    return fixture;
  }

  const bin = await getYtDlpPath();
  let raw: string;
  try {
    raw = await runCapture(bin, [...(await commonArgs()), "-J", "--skip-download", url], {
      timeoutMs: INFO_TIMEOUT_MS,
    });
  } catch (e) {
    throw new Error(mapYtDlpError(e instanceof Error ? e.message : String(e)));
  }

  const info = parseJsonOutput(raw);

  if (info.is_live === true || info.live_status === "is_live" || info.live_status === "is_upcoming") {
    throw new Error("پخش زنده و پریمیر پشتیبانی نمی‌شود؛ پس از پایان پخش دوباره تلاش کنید.");
  }

  const formats = info.formats ?? [];
  if (formats.length === 0) {
    throw new Error("برای این آدرس هیچ فرمت قابل دانلودی پیدا نشد.");
  }

  // بهترین استریم صوتی برای تخمین حجم و نمایش بیت‌ریت منبع
  const audioOnly = formats.filter((f) => (f.vcodec === "none" || !f.vcodec) && f.acodec && f.acodec !== "none");
  const bestAudio = audioOnly.sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0];
  const bestAudioSize = bestAudio ? (bestAudio.filesize ?? bestAudio.filesize_approx ?? null) : null;
  const bestAudioBitrate = bestAudio ? Math.round(bestAudio.abr ?? bestAudio.tbr ?? 0) || null : null;

  // یک فرمت برای هر ارتفاع انتخاب می‌شود: اولویت mp4/H.264 و سپس بیت‌ریت بالاتر
  const byHeight = new Map<number, RawFormat>();
  for (const f of formats) {
    if (!f.height || f.height < 144 || !f.vcodec || f.vcodec === "none") continue;
    // تصاویر «storyboard» (پیش‌نمایش صحنه‌ها) کیفیت ویدئویی نیستند
    if (f.protocol === "mhtml" || /storyboard/i.test(f.format_note ?? "")) continue;
    const existing = byHeight.get(f.height);
    const score = (x: RawFormat) =>
      (x.ext === "mp4" ? 1000 : 0) + (x.vcodec?.startsWith("avc") ? 500 : 0) + (x.tbr ?? 0);
    if (!existing || score(f) > score(existing)) byHeight.set(f.height, f);
  }

  const videoQualities: VideoQuality[] = [...byHeight.values()]
    .map((f) => {
      const hasAudio = Boolean(f.acodec && f.acodec !== "none");
      const vSize = f.filesize ?? f.filesize_approx ?? null;
      const total = vSize == null ? null : hasAudio ? vSize : vSize + (bestAudioSize ?? 0);
      const fps = f.fps ? Math.round(f.fps) : null;
      return {
        height: f.height!,
        label: `${f.height}p${fps && fps > 30 ? fps : ""}`,
        fps,
        // خروجی نهایی همیشه MP4 است (به‌خاطر `--merge-output-format mp4`)
        ext: "mp4",
        vcodec: f.vcodec ?? null,
        filesize: total,
        hasAudio,
      };
    })
    .sort((a, b) => b.height - a.height);

  const duration = typeof info.duration === "number" ? info.duration : null;
  const thumb =
    info.thumbnail ??
    (info.thumbnails?.length ? info.thumbnails[info.thumbnails.length - 1].url : null) ??
    null;

  const result: VideoInfo = {
    id: info.id ?? key,
    title: info.title?.trim() || "بدون عنوان",
    thumbnail: thumb,
    duration,
    uploader: info.uploader ?? info.channel ?? null,
    viewCount: info.view_count ?? null,
    webpageUrl: info.webpage_url ?? url,
    videoQualities,
    audioQualities: buildAudioQualities(duration),
    sourceAudioBitrate: bestAudioBitrate,
  };

  writeCache(key, result);
  return result;
}

/* -------------------------------------------------------------------------- */
/*                               Download engine                              */
/* -------------------------------------------------------------------------- */

/** فرایندهای در حال اجرا (برای امکان لغو) */
const activeProcesses = new Map<string, ChildProcess>();
/** jobهایی که کاربر لغو کرده است */
const cancelledJobs = new Set<string>();

function killTree(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    if (process.platform !== "win32" && child.pid) {
      // با detached شدن فرایند، کشتن گروه، فرزندانِ ffmpeg را هم متوقف می‌کند
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
    /* گروه فرایند دیگر وجود ندارد؛ مستقیم امتحان می‌کنیم */
  }
  try {
    child.kill(signal);
  } catch {
    /* ignore */
  }
}

/**
 * لغو یک دانلود در حال اجرا. ابتدا SIGTERM و در صورت نیاز بعد از ۳ ثانیه SIGKILL.
 * اگر jobی در حال دانلود نباشد `false` برمی‌گردد.
 */
export function cancelDownload(jobId: string): boolean {
  const child = activeProcesses.get(jobId);
  if (!child?.pid) return false;
  cancelledJobs.add(jobId);
  killTree(child, "SIGTERM");
  const timer = setTimeout(() => {
    if (activeProcesses.has(jobId)) killTree(child, "SIGKILL");
  }, 3000);
  timer.unref?.();
  return true;
}

export interface DownloadHandlers {
  onProgress: (metrics: ProgressMetrics) => void;
  onDone: (filePath: string, fileSize: number) => void;
  onError: (message: string) => void;
  onCancelled: () => void;
}

export interface DownloadRequest {
  jobId: string;
  url: string;
  kind: DownloadKind;
  /** برای ویدئو: ارتفاع (مثلاً 1080)؛ برای صدا: بیت‌ریت (مثلاً 320) */
  quality: number;
  /** در حالت نمایشی: آدرس نمونه‌ی محلی به‌جای یوتیوب */
  demo?: boolean;
}

/** آرگومان‌های مشترک (کشف مسیرها و قابلیت‌ها در هر بار اجرا کش می‌شود) */
async function commonArgs(): Promise<string[]> {
  const capabilities = await getYtDlpCapabilities();
  const configuredRemote = process.env.YTDLP_REMOTE_COMPONENTS?.trim();
  return buildCommonArgs({
    capabilities,
    nodePath: process.execPath,
    ffmpegPath: getFfmpegPath(),
    cookiesFile: process.env.YTDLP_COOKIES_FILE?.trim() || null,
    proxy: process.env.YTDLP_PROXY?.trim() || null,
    extraArgs: process.env.YTDLP_EXTRA_ARGS?.trim() || null,
    cacheDir: YTDLP_CACHE_DIR,
    // باینری‌های pip ماژول حل چالش JS را همراه ندارند و باید از راه دور دریافت شود.
    remoteComponents: configuredRemote ?? (capabilities.isSelfContained ? null : "ejs:github"),
  });
}

/** حداکثر حجمی که از stderr نگه می‌داریم (برای پیام خطا) */
const MAX_STDERR = 16_384;

/**
 * یک دانلود را در پس‌زمینه اجرا می‌کند و رخدادها را از طریق `handlers` گزارش می‌دهد.
 */
export async function runDownload(req: DownloadRequest, handlers: DownloadHandlers): Promise<void> {
  const bin = await getYtDlpPath();
  const dir = jobDir(req.jobId);
  await fsp.mkdir(dir, { recursive: true });

  const outTemplate = path.join(/* turbopackIgnore: true */ dir, "output.%(ext)s");
  const args = [
    ...(await commonArgs()),
    ...buildDownloadArgs({ kind: req.kind, quality: req.quality, outTemplate }),
  ];

  const tracker = new DownloadProgressTracker(req.kind);
  let url = req.url;
  if (req.demo || isDemoMode()) {
    // در حالت نمایشی، منبع دانلود همان کلیپ نمونه‌ی محلی است و سرعت آن محدود
    // می‌شود تا نوار پیشرفت (مثل دانلود واقعی) قابل مشاهده باشد.
    const kind = req.kind === "video" ? "video" : "audio";
    await ensureDemoMedia(kind);
    url = demoMediaUrl(demoBaseUrl(), kind);
    const limit = process.env.DEMO_LIMIT_RATE?.trim() || "1500K";
    if (limit !== "0") args.push("--limit-rate", limit);
  }
  args.push(url);

  const child = spawn(/* turbopackIgnore: true */ bin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  activeProcesses.set(req.jobId, child);

  let stderr = "";
  const handleLine = (line: string) => {
    const metrics = tracker.handleLine(line);
    if (metrics) handlers.onProgress(metrics);
  };

  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    parts.forEach(handleLine);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr = (stderr + text).slice(-MAX_STDERR);
    text.split(/\r?\n/).forEach(handleLine);
  });

  child.on("error", (error) => {
    activeProcesses.delete(req.jobId);
    handlers.onError(mapYtDlpError(error.message));
  });

  child.on("close", async (code, signal) => {
    activeProcesses.delete(req.jobId);
    const cancelled = cancelledJobs.delete(req.jobId) || signal !== null;
    if (cancelled) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      handlers.onCancelled();
      return;
    }
    if (code !== 0) {
      handlers.onError(mapYtDlpError(stderr) || `yt-dlp با کد ${code} خارج شد`);
      return;
    }
    try {
      const files = await fsp.readdir(dir);
      const file = pickOutputFile(files, req.kind);
      if (!file) throw new Error("فایل خروجی دانلود پیدا نشد");
      const full = path.join(/* turbopackIgnore: true */ dir, file);
      const stat = await fsp.stat(full);
      handlers.onDone(full, stat.size);
    } catch (e) {
      handlers.onError(cleanYtDlpError(stderr) || (e instanceof Error ? e.message : String(e)));
    }
  });
}

/** حذف پوشه‌ی یک job (پس از انقضا یا لغو) */
export async function removeJobDir(jobId: string): Promise<void> {
  await fsp.rm(jobDir(jobId), { recursive: true, force: true }).catch(() => {});
}
