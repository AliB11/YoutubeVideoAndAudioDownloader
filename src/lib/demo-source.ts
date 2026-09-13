import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getFfmpegPath, runCapture } from "@/lib/toolchain";

/**
 * «حالت نمایشی» (DEMO_MODE) برای اجرای اپلیکیشن در محیط‌هایی که به یوتیوب دسترسی ندارند.
 *
 * در این حالت اطلاعات ویدئو از داده‌ی نمونه خوانده می‌شود و دانلود به‌جای یوتیوب از یک
 * کلیپ نمونه‌ی محلی (که با ffmpeg ساخته می‌شود) انجام می‌گیرد؛ بقیه‌ی مسیر — yt-dlp،
 * پیشرفت لحظه‌ای، ادغام/تبدیل با ffmpeg و تحویل فایل به مرورگر — کاملاً واقعی است.
 */
export function isDemoMode(): boolean {
  const value = (process.env.DEMO_MODE ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export const DEMO_MEDIA_DIR = path.join(
  /* turbopackIgnore: true */ os.tmpdir(),
  "yt-downloader-demo-media",
);

export type DemoKind = "video" | "audio" | "thumbnail";

interface DemoSpec {
  file: string;
  seconds: number;
  args: string[];
  /** نوع تصویر خروجی برای ffmpeg */
  format: "mp4" | "ipod" | "image2";
  mime: string;
}

const SPECS: Record<DemoKind, DemoSpec> = {
  video: {
    file: "sample.mp4",
    seconds: 20,
    format: "mp4",
    mime: "video/mp4",
    args: [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=25",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-shortest",
    ],
  },
  audio: {
    file: "sample.m4a",
    seconds: 30,
    format: "ipod",
    mime: "audio/mp4",
    args: ["-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100", "-c:a", "aac", "-b:a", "128k"],
  },
  thumbnail: {
    // یک فریم واقعی از کلیپ نمونه (کاور دانلودها در حالت نمایشی)
    file: "thumbnail.jpg",
    seconds: 0,
    format: "image2",
    mime: "image/jpeg",
    args: [],
  },
};

/** پسوند فایل متناسب با نوع */
export function demoMime(kind: DemoKind): string {
  return SPECS[kind].mime;
}

const inFlight = new Map<DemoKind, Promise<string>>();

async function exists(file: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(file);
    return stat.size > 1024;
  } catch {
    return false;
  }
}

async function generate(kind: DemoKind): Promise<string> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    throw new Error("حالت نمایشی به ffmpeg نیاز دارد؛ لطفاً ffmpeg را نصب یا FFMPEG_PATH را تنظیم کنید.");
  }
  const spec = SPECS[kind];
  const target = path.join(/* turbopackIgnore: true */ DEMO_MEDIA_DIR, spec.file);
  if (await exists(target)) return target;

  await fsp.mkdir(DEMO_MEDIA_DIR, { recursive: true });
  const tmp = `${target}.part`;
  const args = ["-hide_banner", "-loglevel", "error", "-y"];

  if (kind === "thumbnail") {
    // یک فریم از ثانیه‌ی ۳ کلیپ نمونه
    args.push("-ss", "3", "-i", await generate("video"), "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4");
  } else {
    args.push(...spec.args, "-t", String(spec.seconds));
  }
  args.push("-f", spec.format, tmp);

  await runCapture(ffmpeg, args, { timeoutMs: 120_000 });
  await fsp.rename(tmp, target);
  return target;
}

/** مسیر کلیپ نمونه‌ی محلی (در صورت نبود، ساخته می‌شود) */
export function ensureDemoMedia(kind: DemoKind): Promise<string> {
  const pending = inFlight.get(kind);
  if (pending) return pending;
  const promise = generate(kind).finally(() => inFlight.delete(kind));
  inFlight.set(kind, promise);
  return promise;
}

/** آدرس داخلی همان نمونه که yt-dlp آن را دانلود می‌کند (خودِ سرور اپلیکیشن آن را سرو می‌کند) */
export function demoMediaUrl(origin: string, kind: DemoKind): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/api/demo/media?kind=${kind}`;
}

/** آدرس پایه‌ی سرور برای دانلود داخلی (قابل تنظیم با DEMO_MEDIA_BASE_URL) */
export function demoBaseUrl(): string {
  const configured = process.env.DEMO_MEDIA_BASE_URL?.trim();
  if (configured) return configured;
  const port = process.env.PORT?.trim() || "3000";
  return `http://127.0.0.1:${port}`;
}
