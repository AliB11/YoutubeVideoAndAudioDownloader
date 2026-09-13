import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db, isDbConfigured } from "@/db";
import { downloads, type Download } from "@/db/schema";
import {
  AUDIO_BITRATES,
  cancelDownload,
  removeJobDir,
  runDownload,
  sanitizeFileName,
  type DownloadKind,
  type DownloadRequest,
  type VideoInfo,
} from "@/lib/ytdlp";

/** مدت نگهداری فایل‌های دانلودشده روی سرور (میلی‌ثانیه) */
const FILE_TTL_MS = Number(process.env.FILE_TTL_MINUTES ?? 120) * 60 * 1000;
/** حداکثر دانلود هم‌زمان (بقیه در صف می‌مانند تا منابع سرور اشباع نشود) */
const MAX_CONCURRENT = Math.max(1, Number(process.env.MAX_CONCURRENT_DOWNLOADS ?? 3));

/** زمان راه‌اندازی این نسخه از سرور؛ برای تشخیص jobهای نیمه‌کاره‌ی قبل از ری‌استارت */
const BOOT_TIME = Date.now();

type JobStatus = Download["status"];

interface LiveJob {
  progress: number;
  status: JobStatus;
  speed: string | null;
  eta: string | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  lastDbWrite: number;
}

const globalForJobs = globalThis as typeof globalThis & {
  __ytLiveJobs?: Map<string, LiveJob>;
  __ytMemJobs?: Map<string, Download>;
  __ytJobRequests?: Map<string, DownloadRequest>;
  __ytQueue?: string[];
  __ytRunning?: Set<string>;
  __ytCleanupTimer?: NodeJS.Timeout;
  __ytDbWarns?: Set<string>;
  __ytInitialized?: boolean;
};

const liveJobs = (globalForJobs.__ytLiveJobs ??= new Map<string, LiveJob>());
/**
 * نگه‌داری کامل jobها در حافظه:
 * ۱) برای گزارش پیشرفت زنده بدون خواندن دیتابیس
 * ۲) به‌عنوان fallback وقتی PostgreSQL در دسترس نیست
 */
const memJobs = (globalForJobs.__ytMemJobs ??= new Map<string, Download>());
/** پارامترهای دانلود jobهای همین نسخه از سرور (برای اجرای صف) */
const jobRequests = (globalForJobs.__ytJobRequests ??= new Map<string, DownloadRequest>());
/** صف انتظار برای اجرا */
const queue = (globalForJobs.__ytQueue ??= []);
/** jobهای در حال اجرا */
const running = (globalForJobs.__ytRunning ??= new Set<string>());

function warnOnce(key: string, msg: string) {
  const warned = (globalForJobs.__ytDbWarns ??= new Set<string>());
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(msg);
  }
}

/* -------------------------------------------------------------------------- */
/*                            راه‌اندازی و پاک‌سازی                            */
/* -------------------------------------------------------------------------- */

/**
 * در اولین استفاده: jobهایی که پیش از ری‌استارت سرور در حال دانلود بوده‌اند
 * به‌عنوان خطا علامت می‌خورند (چون فرایند yt-dlp آن‌ها دیگر وجود ندارد) و
 * تایمر پاک‌سازی دوره‌ای راه می‌افتد.
 */
export async function ensureInitialized(): Promise<void> {
  if (!globalForJobs.__ytCleanupTimer) {
    globalForJobs.__ytCleanupTimer = setInterval(() => {
      cleanupExpired().catch((e) => console.error("[jobs] cleanup failed", e));
    }, 5 * 60 * 1000);
    globalForJobs.__ytCleanupTimer.unref?.();
  }
  if (globalForJobs.__ytInitialized) return;
  globalForJobs.__ytInitialized = true;

  if (!isDbConfigured) return;
  try {
    const stale = await db
      .select({ jobId: downloads.jobId })
      .from(downloads)
      .where(
        and(
          inArray(downloads.status, ["pending", "downloading", "processing"]),
          lt(downloads.createdAt, new Date(BOOT_TIME)),
        ),
      );
    if (stale.length === 0) return;
    await db
      .update(downloads)
      .set({
        status: "error",
        error: "سرور پیش از پایان دانلود راه‌اندازی مجدد شد؛ لطفاً دوباره تلاش کنید.",
        completedAt: new Date(),
      })
      .where(inArray(downloads.jobId, stale.map((s) => s.jobId)));
    for (const row of stale) await removeJobDir(row.jobId);
    console.log(`[jobs] ${stale.length} job نیمه‌کاره از اجرای قبلی علامت‌گذاری شد`);
  } catch (e) {
    warnOnce("reconcile", `[jobs] reconcile failed: ${e instanceof Error ? e.message : e}`);
  }
}

export async function cleanupExpired(): Promise<void> {
  const cutoffMs = Date.now() - FILE_TTL_MS;
  const cutoff = new Date(cutoffMs);

  // پاک‌سازی رکوردهای داخل حافظه (فایل + وضعیت)
  for (const [jobId, job] of memJobs) {
    const finished = job.status === "done" || job.status === "error" || job.status === "cancelled";
    if (finished && job.createdAt.getTime() < cutoffMs) {
      await removeJobDir(jobId);
      memJobs.delete(jobId);
      liveJobs.delete(jobId);
      jobRequests.delete(jobId);
    }
  }

  if (!isDbConfigured) return;

  try {
    const expired = await db
      .select({ id: downloads.id, jobId: downloads.jobId })
      .from(downloads)
      .where(
        and(lt(downloads.createdAt, cutoff), inArray(downloads.status, ["done", "error", "cancelled"])),
      );

    for (const row of expired) {
      await removeJobDir(row.jobId);
      memJobs.delete(row.jobId);
      liveJobs.delete(row.jobId);
    }
    if (expired.length) {
      await db
        .update(downloads)
        .set({ filePath: null, status: "expired" })
        .where(inArray(downloads.id, expired.map((r) => r.id)));
    }
  } catch (e) {
    warnOnce("cleanup", `[jobs] cleanup failed: ${e instanceof Error ? e.message : e}`);
  }
}

/* -------------------------------------------------------------------------- */
/*                                  ساخت job                                  */
/* -------------------------------------------------------------------------- */

export interface CreateJobInput {
  url: string;
  kind: DownloadKind;
  quality: number;
  info: Pick<VideoInfo, "id" | "title" | "thumbnail" | "uploader" | "duration">;
}

type JobPatch = Partial<
  Pick<
    Download,
    "progress" | "status" | "filePath" | "fileSize" | "error" | "completedAt"
  >
>;

function qualityLabel(kind: DownloadKind, quality: number): string {
  return kind === "video" ? `${quality}p` : `${quality}kbps`;
}

function buildFileName(title: string | null | undefined, label: string, ext: string): string {
  return `${sanitizeFileName(title ?? "download")} [${label}].${ext}`;
}

/** به‌روزرسانی حافظه و (در صورت وجود دیتابیس) ذخیره‌ی ماندگار */
async function persist(jobId: string, patch: JobPatch): Promise<void> {
  const cur = memJobs.get(jobId);
  if (cur) memJobs.set(jobId, { ...cur, ...patch });

  if (!isDbConfigured) return;
  try {
    await db.update(downloads).set(patch).where(eq(downloads.jobId, jobId));
  } catch (e) {
    warnOnce("update", `[jobs] db update failed: ${e instanceof Error ? e.message : e}`);
  }
}

function isActiveStatus(status: JobStatus): boolean {
  return status === "pending" || status === "downloading" || status === "processing";
}

/** آیا دانلودی با همین مشخصات در حال اجرا/صف است؟ (برای جلوگیری از دانلود تکراری) */
export function findActiveDuplicate(
  url: string,
  kind: DownloadKind,
  quality: string,
): Download | null {
  for (const job of memJobs.values()) {
    const live = liveJobs.get(job.jobId);
    const status = live?.status ?? job.status;
    if (isActiveStatus(status) && job.url === url && job.kind === kind && job.quality === quality) {
      return job;
    }
  }
  return null;
}

export async function createJob(input: CreateJobInput): Promise<{ job: Download; reused: boolean }> {
  await ensureInitialized();

  const label = qualityLabel(input.kind, input.quality);
  const duplicate = findActiveDuplicate(input.url, input.kind, label);
  if (duplicate) return { job: mergeLive(duplicate), reused: true };

  const jobId = randomUUID();
  const ext = input.kind === "video" ? "mp4" : "mp3";
  const fileName = buildFileName(input.info.title, label, ext);

  const values = {
    jobId,
    url: input.url,
    videoId: input.info.id,
    title: input.info.title,
    thumbnail: input.info.thumbnail,
    uploader: input.info.uploader,
    duration: input.info.duration ?? null,
    kind: input.kind,
    quality: label,
    status: "pending" as JobStatus,
    progress: 0,
    fileName,
  };

  let row: Download | null = null;
  if (isDbConfigured) {
    try {
      const [inserted] = await db.insert(downloads).values(values).returning();
      row = inserted;
    } catch (e) {
      warnOnce("insert", `[jobs] db insert failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (!row) {
    // بدون دیتابیس هم دانلود کار می‌کند؛ فقط تاریخچه ماندگار نیست.
    row = {
      ...values,
      id: 0,
      filePath: null,
      fileSize: null,
      error: null,
      createdAt: new Date(),
      completedAt: null,
    };
  }

  memJobs.set(jobId, row);
  liveJobs.set(jobId, {
    progress: 0,
    status: "pending",
    speed: null,
    eta: null,
    downloadedBytes: null,
    totalBytes: null,
    lastDbWrite: 0,
  });
  jobRequests.set(jobId, {
    jobId,
    url: input.url,
    kind: input.kind,
    quality: input.quality,
  });

  if (running.size < MAX_CONCURRENT) {
    void startJob(jobId);
  } else {
    queue.push(jobId);
  }

  return { job: mergeLive(row), reused: false };
}

/* -------------------------------------------------------------------------- */
/*                                اجرای صف                                    */
/* -------------------------------------------------------------------------- */

async function startNext(): Promise<void> {
  while (running.size < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift()!;
    if (!jobRequests.has(next)) continue;
    const live = liveJobs.get(next);
    if (live?.status === "cancelled") continue;
    void startJob(next);
  }
}

async function startJob(jobId: string): Promise<void> {
  const request = jobRequests.get(jobId);
  if (!request) return;
  if (running.has(jobId)) return;

  const live = liveJobs.get(jobId);
  if (live?.status === "cancelled") return;

  running.add(jobId);
  liveJobs.set(jobId, {
    progress: 0,
    status: "downloading",
    speed: null,
    eta: null,
    downloadedBytes: null,
    totalBytes: null,
    lastDbWrite: Date.now(),
  });
  await persist(jobId, { status: "downloading", progress: 0 });

  try {
    await runDownload(request, {
      onProgress: (metrics) => {
        const state = liveJobs.get(jobId);
        if (!state) return;
        state.progress = metrics.percent;
        state.status = metrics.phase;
        state.speed = metrics.speed ?? null;
        state.eta = metrics.eta ?? null;
        state.downloadedBytes = metrics.downloadedBytes ?? null;
        state.totalBytes = metrics.totalBytes ?? null;
        const now = Date.now();
        if (now - state.lastDbWrite > 1500) {
          state.lastDbWrite = now;
          void persist(jobId, { progress: metrics.percent, status: metrics.phase });
        }
      },
      onDone: (filePath, fileSize) => {
        liveJobs.set(jobId, {
          progress: 100,
          status: "done",
          speed: null,
          eta: null,
          downloadedBytes: fileSize,
          totalBytes: fileSize,
          lastDbWrite: Date.now(),
        });
        void persist(jobId, {
          progress: 100,
          status: "done",
          filePath,
          fileSize,
          error: null,
          completedAt: new Date(),
        });
      },
      onError: (message) => {
        liveJobs.set(jobId, {
          progress: 0,
          status: "error",
          speed: null,
          eta: null,
          downloadedBytes: null,
          totalBytes: null,
          lastDbWrite: Date.now(),
        });
        void persist(jobId, { status: "error", error: message, completedAt: new Date() });
      },
      onCancelled: () => {
        liveJobs.set(jobId, {
          progress: 0,
          status: "cancelled",
          speed: null,
          eta: null,
          downloadedBytes: null,
          totalBytes: null,
          lastDbWrite: Date.now(),
        });
        void persist(jobId, { status: "cancelled", error: null, completedAt: new Date() });
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    liveJobs.set(jobId, {
      progress: 0,
      status: "error",
      speed: null,
      eta: null,
      downloadedBytes: null,
      totalBytes: null,
      lastDbWrite: Date.now(),
    });
    await persist(jobId, { status: "error", error: message, completedAt: new Date() });
  } finally {
    running.delete(jobId);
    void startNext();
  }
}

/* -------------------------------------------------------------------------- */
/*                              خواندن وضعیت                                  */
/* -------------------------------------------------------------------------- */

/** ادغام اطلاعات زنده‌ی حافظه (پیشرفت/سرعت/وضعیت) با رکورد دیتابیس */
function mergeLive(row: Download): Download {
  const live = liveJobs.get(row.jobId);
  if (!live) return row;
  if (row.status === "done" || row.status === "error" || row.status === "expired") return row;
  return { ...row, progress: live.progress, status: live.status };
}

export async function getJob(jobId: string): Promise<Download | null> {
  await ensureInitialized();
  const mem = memJobs.get(jobId);
  if (mem) return mergeLive(mem);

  if (!isDbConfigured) return null;
  try {
    const [row] = await db.select().from(downloads).where(eq(downloads.jobId, jobId)).limit(1);
    return row ? mergeLive(row) : null;
  } catch (e) {
    warnOnce("get", `[jobs] db select failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * لغو یک دانلود (در حال اجرا یا در صف).
 * خروجی: پیام خطا (فارسی) یا `null` در صورت موفقیت.
 */
export async function cancelJob(jobId: string): Promise<string | null> {
  const job = await getJob(jobId);
  if (!job) return "دانلود پیدا نشد";
  if (job.status === "done") return "دانلود تمام شده و قابل لغو نیست";
  if (job.status === "error") return "این دانلود قبلاً با خطا متوقف شده است";
  if (job.status === "cancelled") return "این دانلود قبلاً لغو شده است";
  if (job.status === "expired") return "این دانلود منقضی شده است";

  // اگر در صف است، فقط از صف حذف می‌شود
  const queueIndex = queue.indexOf(jobId);
  if (queueIndex >= 0) queue.splice(queueIndex, 1);

  // اگر فرایند فعالی وجود دارد، متوقف می‌شود (تکمیل لغو توسط onCancelled انجام می‌شود)
  cancelDownload(jobId);

  liveJobs.set(jobId, {
    progress: 0,
    status: "cancelled",
    speed: null,
    eta: null,
    downloadedBytes: null,
    totalBytes: null,
    lastDbWrite: Date.now(),
  });
  jobRequests.delete(jobId);
  await persist(jobId, { status: "cancelled", error: null, completedAt: new Date() });
  await removeJobDir(jobId);
  return null;
}

/** حذف کامل یک دانلود از تاریخچه و پاک‌کردن فایل‌های آن */
export async function deleteJob(jobId: string): Promise<boolean> {
  await ensureInitialized();
  const job = await getJob(jobId);
  if (!job) return false;

  const queueIndex = queue.indexOf(jobId);
  if (queueIndex >= 0) queue.splice(queueIndex, 1);

  cancelDownload(jobId);
  liveJobs.delete(jobId);
  memJobs.delete(jobId);
  jobRequests.delete(jobId);
  await removeJobDir(jobId);

  if (isDbConfigured) {
    try {
      await db.delete(downloads).where(eq(downloads.jobId, jobId));
    } catch (e) {
      warnOnce("delete", `[jobs] db delete failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return true;
}

/** فهرست آخرین دانلودها (تاریخچه) — از دیتابیس یا در نبود آن از حافظه */
export async function listJobs(limit = 30): Promise<Download[]> {
  await ensureInitialized();
  if (isDbConfigured) {
    try {
      const rows = await db.select().from(downloads).orderBy(desc(downloads.createdAt)).limit(limit);
      return rows.map(mergeLive);
    } catch (e) {
      warnOnce("select", `[jobs] db select failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return [...memJobs.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(mergeLive);
}

/* -------------------------------------------------------------------------- */
/*                              خروجی عمومی                                   */
/* -------------------------------------------------------------------------- */

export interface PublicJob {
  jobId: string;
  videoId: string | null;
  title: string | null;
  thumbnail: string | null;
  uploader: string | null;
  duration: number | null;
  kind: string;
  quality: string;
  status: JobStatus;
  progress: number;
  fileName: string | null;
  fileSize: number | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
  downloadUrl: string | null;
  /** سرعت لحظه‌ای دانلود (فقط برای jobهای در حال اجرا) */
  speed: string | null;
  /** زمان تخمینی باقی‌مانده (فقط برای jobهای در حال اجرا) */
  eta: string | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  /** رتبه در صف (۰ یعنی در حال اجرا) */
  queuePosition: number | null;
}

export function toPublicJob(row: Download): PublicJob {
  const live = liveJobs.get(row.jobId);
  const status = row.status === "done" || row.status === "error" || row.status === "expired"
    ? row.status
    : (live?.status ?? row.status);
  const queued = queue.indexOf(row.jobId);

  return {
    jobId: row.jobId,
    videoId: row.videoId,
    title: row.title,
    thumbnail: row.thumbnail,
    uploader: row.uploader,
    duration: row.duration,
    kind: row.kind,
    quality: row.quality,
    status,
    progress: status === "done" ? 100 : (live?.progress ?? row.progress),
    fileName: row.fileName,
    fileSize: row.fileSize,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    downloadUrl: status === "done" ? `/api/jobs/${row.jobId}/file` : null,
    speed: live?.speed ?? null,
    eta: live?.eta ?? null,
    downloadedBytes: live?.downloadedBytes ?? null,
    totalBytes: live?.totalBytes ?? null,
    queuePosition: status === "pending" && queued >= 0 ? queued + 1 : null,
  };
}

/** وضعیت صف برای اندپوینت سلامت */
export function getQueueStatus() {
  return { active: running.size, queued: queue.length, max: MAX_CONCURRENT };
}

/** بیت‌ریت‌های مجاز صدا (برای اعتبارسنجی در API) */
export function isAllowedAudioBitrate(value: number): boolean {
  return (AUDIO_BITRATES as readonly number[]).includes(value);
}
