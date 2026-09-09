import { spawn } from "node:child_process";
import fs, { createWriteStream } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, pipeline } from "node:stream";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const pipelineAsync = promisify(pipeline);

/* -------------------------------------------------------------------------- */
/*                               Binary handling                              */
/* -------------------------------------------------------------------------- */

const BIN_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), ".bin");
const YTDLP_LOCAL = `${BIN_DIR}${path.sep}${process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"}`;

let ytdlpPathPromise: Promise<string> | null = null;
let supportsJsRuntimesCache: boolean | null = null;

const YTDLP_RELEASE_URL =
  process.platform === "win32"
    ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

function fileExists(p: string) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function whichSync(cmd: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  const sep = path.sep;
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const full = dir.endsWith(sep) ? dir + cmd : dir + sep + cmd;
    if (fileExists(full)) return full;
  }
  return null;
}

/**
 * آخرین نسخه‌ی باینری yt-dlp را از ریلیز رسمی GitHub دانلود می‌کند
 * (بدون وابستگی به پکیج منسوخ‌شده‌ی yt-dlp-wrap).
 */
async function downloadYtDlpBinary(target: string): Promise<void> {
  await fsp.mkdir(BIN_DIR, { recursive: true });
  console.log("[ytdlp] downloading yt-dlp binary from GitHub...");
  const res = await fetch(YTDLP_RELEASE_URL, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`دریافت باینری yt-dlp ناموفق بود (HTTP ${res.status})`);
  }
  const tmp = `${target}.part`;
  await pipelineAsync(
    Readable.fromWeb(res.body as never),
    createWriteStream(tmp, { mode: 0o755 }),
  );
  await fsp.rename(tmp, target);
  await fsp.chmod(target, 0o755);
  console.log("[ytdlp] yt-dlp downloaded to", target);
}

/**
 * مسیر باینری yt-dlp را برمی‌گرداند. در صورت نبود، آخرین نسخه را از GitHub دانلود می‌کند.
 */
export function getYtDlpPath(): Promise<string> {
  if (ytdlpPathPromise) return ytdlpPathPromise;

  ytdlpPathPromise = (async () => {
    if (process.env.YTDLP_PATH && fileExists(process.env.YTDLP_PATH)) {
      return process.env.YTDLP_PATH;
    }
    if (fileExists(YTDLP_LOCAL)) return YTDLP_LOCAL;

    const system = whichSync("yt-dlp");
    if (system) return system;

    await downloadYtDlpBinary(YTDLP_LOCAL);
    return YTDLP_LOCAL;
  })();

  ytdlpPathPromise.catch(() => {
    ytdlpPathPromise = null;
  });

  return ytdlpPathPromise;
}

export function getFfmpegPath(): string | null {
  if (process.env.FFMPEG_PATH && fileExists(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const staticPath = ffmpegStatic as unknown as string | null;
  if (staticPath && fileExists(staticPath)) return staticPath;
  return whichSync("ffmpeg");
}

async function supportsJsRuntimes(bin: string): Promise<boolean> {
  if (supportsJsRuntimesCache !== null) return supportsJsRuntimesCache;
  const help = await runCapture(bin, ["--help"]).catch(() => "");
  supportsJsRuntimesCache = help.includes("--js-runtimes");
  return supportsJsRuntimesCache;
}

/** آرگومان‌های مشترک تمام فراخوانی‌های yt-dlp */
async function commonArgs(): Promise<string[]> {
  const bin = await getYtDlpPath();
  const args = ["--no-playlist", "--no-warnings", "--no-check-certificates"];

  const ffmpeg = getFfmpegPath();
  if (ffmpeg) args.push("--ffmpeg-location", ffmpeg);

  // yt-dlp جدید برای حل چالش‌های یوتیوب به یک JS runtime نیاز دارد؛ Node را فعال می‌کنیم.
  if (await supportsJsRuntimes(bin)) {
    args.push("--js-runtimes", `node:${process.execPath}`);
  }

  if (process.env.YTDLP_COOKIES_FILE && fs.existsSync(process.env.YTDLP_COOKIES_FILE)) {
    args.push("--cookies", process.env.YTDLP_COOKIES_FILE);
  }
  if (process.env.YTDLP_PROXY) {
    args.push("--proxy", process.env.YTDLP_PROXY);
  }
  if (process.env.YTDLP_EXTRA_ARGS) {
    args.push(...process.env.YTDLP_EXTRA_ARGS.split(" ").filter(Boolean));
  }
  return args;
}

function runCapture(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(cleanError(err) || `yt-dlp exited with code ${code}`));
    });
  });
}

function cleanError(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("ERROR"));
  const last = lines[lines.length - 1] ?? stderr.trim().split("\n").pop() ?? "";
  return last.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, "").slice(0, 400);
}

/* -------------------------------------------------------------------------- */
/*                                  Video info                                */
/* -------------------------------------------------------------------------- */

export interface VideoQuality {
  height: number;
  label: string; // "1080p"
  fps: number | null;
  ext: string;
  vcodec: string | null;
  filesize: number | null; // تخمین حجم (ویدئو + صدا)
  hasAudio: boolean;
}

export interface AudioQuality {
  bitrate: number; // kbps
  label: string; // "320 kbps"
  filesize: number | null;
  tag: string; // توضیح کوتاه
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
  id: string;
  title: string;
  thumbnail?: string;
  thumbnails?: { url: string }[];
  duration?: number;
  uploader?: string;
  channel?: string;
  view_count?: number;
  webpage_url?: string;
  formats?: RawFormat[];
}

const MP3_BITRATES = [320, 256, 192, 160, 128, 96, 64];

export function isValidYoutubeUrl(input: string): boolean {
  try {
    const u = new URL(input.trim());
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
    return ["youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host);
  } catch {
    return false;
  }
}

export async function fetchVideoInfo(url: string): Promise<VideoInfo> {
  const bin = await getYtDlpPath();
  const args = [...(await commonArgs()), "-J", "--skip-download", url];
  const raw = await runCapture(bin, args);
  const info = JSON.parse(raw) as RawInfo;

  const formats = info.formats ?? [];

  // بهترین استریم صوتی برای تخمین حجم
  const audioOnly = formats.filter(
    (f) => (f.vcodec === "none" || !f.vcodec) && f.acodec && f.acodec !== "none",
  );
  const bestAudio = audioOnly.sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0];
  const bestAudioSize = bestAudio ? bestAudio.filesize ?? bestAudio.filesize_approx ?? null : null;
  const bestAudioBitrate = bestAudio ? Math.round(bestAudio.abr ?? bestAudio.tbr ?? 0) : null;

  // گروه‌بندی کیفیت‌های ویدئویی بر اساس ارتفاع
  const byHeight = new Map<number, RawFormat>();
  for (const f of formats) {
    if (!f.height || !f.vcodec || f.vcodec === "none") continue;
    if (f.protocol && /m3u8/.test(f.protocol)) continue; // ترجیح فرمت‌های مستقیم
    const existing = byHeight.get(f.height);
    if (!existing) {
      byHeight.set(f.height, f);
      continue;
    }
    // ترجیح: mp4 > سایر، سپس بیت‌ریت بالاتر
    const score = (x: RawFormat) =>
      (x.ext === "mp4" ? 1000 : 0) + (x.tbr ?? 0) + (x.fps ?? 0);
    if (score(f) > score(existing)) byHeight.set(f.height, f);
  }

  const videoQualities: VideoQuality[] = [...byHeight.values()]
    .map((f) => {
      const hasAudio = !!f.acodec && f.acodec !== "none";
      const vSize = f.filesize ?? f.filesize_approx ?? null;
      const total =
        vSize == null ? null : hasAudio ? vSize : vSize + (bestAudioSize ?? 0);
      return {
        height: f.height!,
        label: `${f.height}p${f.fps && f.fps > 30 ? Math.round(f.fps) : ""}`,
        fps: f.fps ? Math.round(f.fps) : null,
        ext: "mp4",
        vcodec: f.vcodec ?? null,
        filesize: total,
        hasAudio,
      };
    })
    .sort((a, b) => b.height - a.height);

  const duration = info.duration ?? null;
  const audioQualities: AudioQuality[] = MP3_BITRATES.map((br) => ({
    bitrate: br,
    label: `${br} kbps`,
    filesize: duration ? Math.round((br * 1000 * duration) / 8) : null,
    tag:
      br >= 320
        ? "بالاترین کیفیت"
        : br >= 192
          ? "کیفیت عالی"
          : br >= 128
            ? "کیفیت استاندارد"
            : "حجم کم",
  }));

  const thumb =
    info.thumbnail ??
    (info.thumbnails && info.thumbnails.length
      ? info.thumbnails[info.thumbnails.length - 1].url
      : null);

  return {
    id: info.id,
    title: info.title,
    thumbnail: thumb ?? null,
    duration,
    uploader: info.uploader ?? info.channel ?? null,
    viewCount: info.view_count ?? null,
    webpageUrl: info.webpage_url ?? url,
    videoQualities,
    audioQualities,
    sourceAudioBitrate: bestAudioBitrate,
  };
}

/* -------------------------------------------------------------------------- */
/*                               Download engine                              */
/* -------------------------------------------------------------------------- */

export const DOWNLOAD_ROOT = path.join(/* turbopackIgnore: true */ os.tmpdir(), "yt-downloader-jobs");

export interface DownloadHandlers {
  onProgress: (progress: number, status: "downloading" | "processing") => void;
  onDone: (filePath: string, fileSize: number) => void;
  onError: (message: string) => void;
}

export interface DownloadRequest {
  jobId: string;
  url: string;
  kind: "video" | "audio";
  /** برای ویدئو: ارتفاع (مثلاً 1080)؛ برای صدا: بیت‌ریت (مثلاً 320) */
  quality: number;
}

export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "download"
  );
}

/**
 * یک دانلود را در پس‌زمینه اجرا می‌کند و پیشرفت را از طریق handlers گزارش می‌دهد.
 */
export async function runDownload(req: DownloadRequest, handlers: DownloadHandlers) {
  const bin = await getYtDlpPath();
  const dir = `${DOWNLOAD_ROOT}${path.sep}${req.jobId}`;
  await fsp.mkdir(dir, { recursive: true });

  const outTemplate = `${dir}${path.sep}output.%(ext)s`;
  const args = [...(await commonArgs()), "--newline", "--progress", "-o", outTemplate];

  if (req.kind === "video") {
    const h = req.quality;
    args.push(
      "-f",
      [
        // اولویت با H.264 (بیشترین سازگاری)، سپس هر mp4، سپس هر چیزی
        `bestvideo[height<=${h}][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]`,
        `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]`,
        `bestvideo[height<=${h}]+bestaudio`,
        `best[height<=${h}]`,
        "best",
      ].join("/"),
      "--merge-output-format",
      "mp4",
      // برای سازگاری با اکثر پلیرها
      "--postprocessor-args",
      "Merger:-movflags +faststart",
    );
  } else {
    args.push(
      "-f",
      "bestaudio/best",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      `${req.quality}K`,
      "--embed-thumbnail",
      "--add-metadata",
    );
  }

  args.push(req.url);

  const child = spawn(/* turbopackIgnore: true */ bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  let lastProgress = 0;
  let downloadPhase = 0; // برای دانلودهای چندبخشی (ویدئو + صدا)
  let phaseCount = req.kind === "video" ? 2 : 1;

  const handleLine = (line: string) => {
    const l = line.trim();
    if (!l) return;

    // [download]  45.3% of 12.34MiB at 1.2MiB/s ETA 00:05
    const m = /^\[download\]\s+([\d.]+)%/.exec(l);
    if (m) {
      const pct = parseFloat(m[1]);
      if (pct === 100 && lastProgress < 100) {
        // پایان یک بخش
      }
      let overall: number;
      if (req.kind === "video") {
        overall = Math.round((downloadPhase * 100 + pct) / phaseCount);
      } else {
        overall = Math.round(pct * 0.9);
      }
      overall = Math.min(overall, 95);
      if (overall !== lastProgress) {
        lastProgress = overall;
        handlers.onProgress(overall, "downloading");
      }
      if (pct >= 100) downloadPhase = Math.min(downloadPhase + 1, phaseCount - 1);
      return;
    }
    if (/^\[download\] Destination:/.test(l) && req.kind === "video") {
      // آغاز یک بخش جدید
      return;
    }
    if (/has already been downloaded/.test(l)) {
      downloadPhase = Math.min(downloadPhase + 1, phaseCount - 1);
      return;
    }
    if (/^\[(Merger|ExtractAudio|Metadata|EmbedThumbnail|ffmpeg|FixupM3u8)\]/i.test(l)) {
      handlers.onProgress(Math.max(lastProgress, 96), "processing");
      return;
    }
    if (/^\[info\].*format\(s\)/.test(l)) {
      // e.g. "[info] xyz: Downloading 1 format(s): 137+140"
      const fm = /Downloading (\d+) format/.exec(l);
      if (fm) phaseCount = Math.max(1, parseInt(fm[1], 10));
    }
  };

  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() ?? "";
    parts.forEach(handleLine);
  });
  child.stderr.on("data", (d) => {
    const s = d.toString();
    stderr += s;
    s.split(/\r?\n/).forEach(handleLine);
  });

  child.on("error", (e) => handlers.onError(e.message));
  child.on("close", async (code) => {
    if (code !== 0) {
      handlers.onError(cleanError(stderr) || `yt-dlp exited with code ${code}`);
      return;
    }
    try {
      const wantedExt = req.kind === "video" ? ".mp4" : ".mp3";
      const files = await fsp.readdir(dir);
      let file = files.find((f) => f.toLowerCase().endsWith(wantedExt));
      if (!file) {
        // در صورت عدم ادغام، هر خروجی معتبری را می‌پذیریم
        file = files.find((f) => f.startsWith("output.") && !/\.(part|ytdl|webp|jpg|png)$/.test(f));
      }
      if (!file) throw new Error("فایل خروجی پیدا نشد");
      const full = `${dir}${path.sep}${file}`;
      const stat = await fsp.stat(full);
      handlers.onDone(full, stat.size);
    } catch (e) {
      handlers.onError(e instanceof Error ? e.message : String(e));
    }
  });

  return child;
}

/** حذف پوشه یک job (پس از انقضا) */
export async function removeJobDir(jobId: string) {
  const dir = `${DOWNLOAD_ROOT}${path.sep}${jobId}`;
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
}
