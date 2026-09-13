import { spawn } from "node:child_process";
import fs, { createWriteStream } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, pipeline } from "node:stream";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import type { YtDlpCapabilities } from "@/lib/ytdlp-args";

const pipelineAsync = promisify(pipeline);

/* -------------------------------------------------------------------------- */
/*                            مسیرهای باینری‌ها                              */
/* -------------------------------------------------------------------------- */

const BIN_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), ".bin");
const YTDLP_LOCAL = path.join(
  /* turbopackIgnore: true */ BIN_DIR,
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
);

const YTDLP_RELEASE_URL =
  process.platform === "win32"
    ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

/** پوشه‌ی کش داخلی yt-dlp (فایل‌های امضای ویدئوها برای درخواست‌های بعدی) */
export const YTDLP_CACHE_DIR =
  process.env.YTDLP_CACHE_DIR?.trim() || path.join(/* turbopackIgnore: true */ os.tmpdir(), "yt-dlp-cache");

function fileExists(p: string | null | undefined): p is string {
  if (!p) return false;
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function fileReadable(p: string | null | undefined): p is string {
  if (!p) return false;
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function whichSync(cmd: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, cmd);
    if (fileExists(full)) return full;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*                                 yt-dlp                                     */
/* -------------------------------------------------------------------------- */

let ytdlpPromise: Promise<string> | null = null;

async function downloadYtDlpBinary(target: string): Promise<void> {
  await fsp.mkdir(BIN_DIR, { recursive: true });
  console.log("[ytdlp] downloading yt-dlp binary from GitHub...");
  const res = await fetch(YTDLP_RELEASE_URL, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(
      `دریافت باینری yt-dlp ناموفق بود (HTTP ${res.status}). لطفاً yt-dlp را دستی نصب و مسیر آن را در YTDLP_PATH تنظیم کنید.`,
    );
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

export type ToolSource = "env" | "local" | "system" | "downloaded";

let ytdlpSource: ToolSource | null = null;
/** آخرین مسیر موفق (کش‌شده) برای بررسی‌های سبک مثل اندپوینت سلامت */
let resolvedYtdlpPath: string | null = null;

/**
 * مسیر yt-dlp بدون هیچ تلاشی برای دانلود (برای اندپوینت سلامت؛ نباید
 * باعث دانلود چند ده مگابایتی شود).
 */
export function peekYtDlpPath(): string | null {
  if (resolvedYtdlpPath) return resolvedYtdlpPath;
  const fromEnv = process.env.YTDLP_PATH?.trim();
  if (fileExists(fromEnv)) return fromEnv;
  if (fileExists(YTDLP_LOCAL)) return YTDLP_LOCAL;
  return whichSync(process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

/**
 * مسیر باینری yt-dlp. ترتیب اولویت: `YTDLP_PATH` → `.bin/` پروژه → PATH → دانلود از GitHub.
 * نتیجه به‌صورت promise کش می‌شود و در صورت خطا، کش پاک می‌شود تا درخواست بعدی دوباره تلاش کند.
 */
export function getYtDlpPath(): Promise<string> {
  if (!ytdlpPromise) {
    ytdlpPromise = (async () => {
      try {
        const fromEnv = process.env.YTDLP_PATH?.trim();
        if (fileExists(fromEnv)) {
          ytdlpSource = "env";
          resolvedYtdlpPath = fromEnv;
          return fromEnv;
        }
        if (fileExists(YTDLP_LOCAL)) {
          ytdlpSource = "local";
          resolvedYtdlpPath = YTDLP_LOCAL;
          return YTDLP_LOCAL;
        }
        const system = whichSync(process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
        if (system) {
          ytdlpSource = "system";
          resolvedYtdlpPath = system;
          return system;
        }
        await downloadYtDlpBinary(YTDLP_LOCAL);
        ytdlpSource = "downloaded";
        resolvedYtdlpPath = YTDLP_LOCAL;
        return YTDLP_LOCAL;
      } catch (e) {
        ytdlpPromise = null;
        throw e;
      }
    })();
  }
  return ytdlpPromise;
}

/** مسیر ffmpeg: `FFMPEG_PATH` → پکیج ffmpeg-static → PATH */
export function getFfmpegPath(): string | null {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fileExists(fromEnv)) return fromEnv;
  const staticPath = ffmpegStatic as unknown as string | null;
  if (fileExists(staticPath)) return staticPath;
  if (fileReadable(staticPath)) return staticPath;
  return whichSync(process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
}

/* -------------------------------------------------------------------------- */
/*                        قابلیت‌های باینری و نسخه‌ها                        */
/* -------------------------------------------------------------------------- */

export function runCapture(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: opts.cwd,
    });
    let out = "";
    let err = "";
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        finish(() => reject(new Error(`زمان اجرای yt-dlp به پایان رسید (${opts.timeoutMs}ms)`)));
      }, opts.timeoutMs);
      timer.unref?.();
    }

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", (code) => {
      finish(() => {
        if (code === 0) resolve(out);
        else reject(new Error(err.trim() || `yt-dlp exited with code ${code}`));
      });
    });
  });
}

let capabilitiesPromise: Promise<YtDlpCapabilities> | null = null;

/** آیا فایل باینری مستقل است (باینری رسمی) یا اسکریپت/zipapp نصب‌شده با pip؟ */
function detectSelfContained(binPath: string): boolean {
  try {
    const stat = fs.statSync(binPath);
    // باینری‌های رسمی yt-dlp حدود ۳۰ مگابایت هستند؛ اسکریپت pip یا zipapp بسیار کوچک‌اند.
    if (stat.size < 5 * 1024 * 1024) return false;
    const fd = fs.openSync(binPath, "r");
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    const magic = header.toString("hex");
    // ELF (\x7fELF) یا Mach-O یا PE (MZ)
    return magic.startsWith("7f454c46") || magic.startsWith("4d5a") ||
      magic.startsWith("cffaedfe") || magic.startsWith("cafebabe");
  } catch {
    return false;
  }
}

export function getYtDlpCapabilities(): Promise<YtDlpCapabilities> {
  if (!capabilitiesPromise) {
    capabilitiesPromise = (async () => {
      const bin = await getYtDlpPath();
      const [help, version] = await Promise.all([
        runCapture(bin, ["--help"], { timeoutMs: 30_000 }).catch(() => ""),
        runCapture(bin, ["--version"], { timeoutMs: 30_000 }).catch(() => ""),
      ]);
      return {
        version: version.trim().split("\n").pop()?.trim() || null,
        supportsJsRuntimes: help.includes("--js-runtimes"),
        supportsRemoteComponents: help.includes("--remote-components"),
        isSelfContained: detectSelfContained(bin),
      } satisfies YtDlpCapabilities;
    })().catch((e) => {
      capabilitiesPromise = null;
      throw e;
    });
  }
  return capabilitiesPromise;
}

let ffmpegVersionPromise: Promise<string | null> | null = null;

export function getFfmpegVersion(): Promise<string | null> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) return Promise.resolve(null);
  ffmpegVersionPromise ??= runCapture(ffmpeg, ["-version"], { timeoutMs: 20_000 })
    .then((out) => /ffmpeg version (\S+)/.exec(out)?.[1] ?? null)
    .catch(() => null);
  return ffmpegVersionPromise;
}

export interface ToolchainStatus {
  ytdlp: { available: boolean; path: string | null; version: string | null; source: ToolSource | null };
  ffmpeg: { available: boolean; path: string | null; version: string | null };
}

/** وضعیت ابزارهای لازم (برای صفحه‌ی وضعیت و اندپوینت سلامت) */
export async function getToolchainStatus(): Promise<ToolchainStatus> {
  const ffmpegPath = getFfmpegPath();
  const [ytdlp, ffmpegVersion] = await Promise.all([
    (async () => {
      const bin = peekYtDlpPath();
      if (!bin) return { available: false, path: null, version: null, source: null };
      const version = await getYtDlpCapabilities()
        .then((caps) => caps.version)
        .catch(() => null);
      return { available: true, path: bin, version, source: ytdlpSource };
    })(),
    getFfmpegVersion(),
  ]);

  return {
    ytdlp,
    ffmpeg: { available: Boolean(ffmpegPath), path: ffmpegPath ?? null, version: ffmpegVersion },
  };
}
