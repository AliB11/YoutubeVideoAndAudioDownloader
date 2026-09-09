import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db, isDbConfigured } from "@/db";
import { downloads, type Download } from "@/db/schema";
import {
  cancelDownload,
  removeJobDir,
  runDownload,
  sanitizeFileName,
  type VideoInfo,
} from "@/lib/ytdlp";

/** مدت نگهداری فایل‌های دانلودشده روی سرور (میلی‌ثانیه) */
const FILE_TTL_MS = Number(process.env.FILE_TTL_MINUTES ?? 120) * 60 * 1000;

interface LiveJob {
  progress: number;
  status: Download["status"];
  lastDbWrite: number;
}

const globalForJobs = globalThis as typeof globalThis & {
  __ytLiveJobs?: Map<string, LiveJob>;
  __ytMemJobs?: Map<string, Download>;
  __ytCleanupTimer?: NodeJS.Timeout;
  __ytDbWarns?: Set<string>;
};

const liveJobs = (globalForJobs.__ytLiveJobs ??= new Map<string, LiveJob>());
/**
 * نگه‌داری کامل jobها در حافظه:
 * ۱) برای گزارش پیشرفت زنده بدون نیاز به خواندن دیتابیس
 * ۲) به‌عنوان fallback وقتی PostgreSQL در دسترس نیست (تاریخچه ذخیره نمی‌شود اما دانلود کار می‌کند)
 */
const memJobs = (globalForJobs.__ytMemJobs ??= new Map<string, Download>());

function warnOnce(key: string, msg: string) {
  const warned = (globalForJobs.__ytDbWarns ??= new Set<string>());
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(msg);
  }
}

function ensureCleanupTimer() {
  if (globalForJobs.__ytCleanupTimer) return;
  globalForJobs.__ytCleanupTimer = setInterval(() => {
    cleanupExpired().catch((e) => console.error("[jobs] cleanup failed", e));
  }, 5 * 60 * 1000);
  globalForJobs.__ytCleanupTimer.unref?.();
}

export async function cleanupExpired() {
  const cutoffMs = Date.now() - FILE_TTL_MS;
  const cutoff = new Date(cutoffMs);

  // پاک‌سازی رکوردهای داخل حافظه (فایل + وضعیت)
  for (const [jobId, job] of memJobs) {
    const finished =
      job.status === "done" || job.status === "error" || job.status === "cancelled";
    if (finished && job.createdAt.getTime() < cutoffMs) {
      await removeJobDir(jobId);
      memJobs.delete(jobId);
      liveJobs.delete(jobId);
    }
  }

  if (!isDbConfigured) return;

  try {
    const expired = await db
      .select({ id: downloads.id, jobId: downloads.jobId })
      .from(downloads)
      .where(
        and(
          lt(downloads.createdAt, cutoff),
          inArray(downloads.status, ["done", "error", "cancelled"]),
        ),
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
        .where(
          inArray(
            downloads.id,
            expired.map((r) => r.id),
          ),
        );
    }
  } catch (e) {
    warnOnce("cleanup", `[jobs] cleanup failed: ${e instanceof Error ? e.message : e}`);
  }
}

export interface CreateJobInput {
  url: string;
  kind: "video" | "audio";
  quality: number;
  info: Pick<VideoInfo, "id" | "title" | "thumbnail" | "uploader" | "duration">;
}

type JobPatch = Partial<
  Pick<Download, "progress" | "status" | "filePath" | "fileSize" | "error" | "completedAt">
>;

function buildFileName(title: string | null | undefined, qualityLabel: string, ext: string) {
  const safeTitle = sanitizeFileName(title ?? "download");
  return `${safeTitle} [${qualityLabel}].${ext}`;
}

/** به‌روزرسانی حافظه و (در صورت وجود دیتابیس) ذخیره‌ی ماندگار */
async function persist(jobId: string, patch: JobPatch) {
  const cur = memJobs.get(jobId);
  if (cur) memJobs.set(jobId, { ...cur, ...patch });

  if (!isDbConfigured) return;
  try {
    await db.update(downloads).set(patch).where(eq(downloads.jobId, jobId));
  } catch (e) {
    warnOnce("update", `[jobs] db update failed: ${e instanceof Error ? e.message : e}`);
  }
}

export async function createJob(input: CreateJobInput): Promise<Download> {
  ensureCleanupTimer();
  const jobId = randomUUID();
  const qualityLabel = input.kind === "video" ? `${input.quality}p` : `${input.quality}kbps`;
  const ext = input.kind === "video" ? "mp4" : "mp3";
  const fileName = buildFileName(input.info.title, qualityLabel, ext);

  const values = {
    jobId,
    url: input.url,
    videoId: input.info.id,
    title: input.info.title,
    thumbnail: input.info.thumbnail,
    uploader: input.info.uploader,
    duration: input.info.duration ?? null,
    kind: input.kind,
    quality: qualityLabel,
    status: "downloading",
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

  // اگر دیتابیس در دسترس نبود، یک رکورد در حافظه می‌سازیم تا دانلود همچنان کار کند
  if (!row) {
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
  liveJobs.set(jobId, { progress: 0, status: "downloading", lastDbWrite: 0 });

  runDownload(
    { jobId, url: input.url, kind: input.kind, quality: input.quality },
    {
      onProgress: (progress, status) => {
        const live = liveJobs.get(jobId);
        if (!live) return;
        live.progress = progress;
        live.status = status;
        const now = Date.now();
        if (now - live.lastDbWrite > 1500) {
          live.lastDbWrite = now;
          void persist(jobId, { progress, status });
        }
      },
      onDone: (filePath, fileSize) => {
        liveJobs.set(jobId, { progress: 100, status: "done", lastDbWrite: Date.now() });
        void persist(jobId, {
          progress: 100,
          status: "done",
          filePath,
          fileSize,
          completedAt: new Date(),
        });
      },
      onError: (message) => {
        liveJobs.set(jobId, { progress: 0, status: "error", lastDbWrite: Date.now() });
        void persist(jobId, { status: "error", error: message, completedAt: new Date() });
      },
      onCancelled: () => {
        liveJobs.set(jobId, { progress: 0, status: "cancelled", lastDbWrite: Date.now() });
        void persist(jobId, {
          status: "cancelled",
          error: null,
          completedAt: new Date(),
        });
      },
    },
  ).catch((e) => {
    const message = e instanceof Error ? e.message : String(e);
    liveJobs.set(jobId, { progress: 0, status: "error", lastDbWrite: Date.now() });
    void persist(jobId, { status: "error", error: message, completedAt: new Date() });
  });

  return row;
}

export async function getJob(jobId: string): Promise<Download | null> {
  const mem = memJobs.get(jobId);
  const live = liveJobs.get(jobId);
  if (mem) {
    if (live && mem.status !== "done" && mem.status !== "error") {
      return { ...mem, progress: live.progress, status: live.status };
    }
    return mem;
  }

  if (!isDbConfigured) return null;

  try {
    const [row] = await db.select().from(downloads).where(eq(downloads.jobId, jobId)).limit(1);
    return row ?? null;
  } catch (e) {
    warnOnce("get", `[jobs] db select failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * لغو یک دانلودِ در حال اجرا. تنها jobهایی که هنوز در حال دانلود/پردازش هستند
 * قابل لغو هستند. خروجی مقدار خطا (به‌فارسی) یا null در صورت موفقیت است.
 */
export async function cancelJob(jobId: string): Promise<string | null> {
  const job = await getJob(jobId);
  if (!job) return "دانلود پیدا نشد";
  if (job.status === "done") return "دانلود تمام شده و قابل لغو نیست";
  if (job.status === "error") return "این دانلود قبلاً با خطا متوقف شده است";
  if (job.status === "cancelled") return "این دانلود قبلاً لغو شده است";
  if (job.status === "expired") return "این دانلود منقضی شده است";

  // اگر فرایند فعالی وجود داشت، آن را متوقف می‌کنیم (تکمیل لغو توسط onCancelled انجام می‌شود)
  cancelDownload(jobId);
  liveJobs.set(jobId, { progress: 0, status: "cancelled", lastDbWrite: Date.now() });
  await persist(jobId, { status: "cancelled", error: null, completedAt: new Date() });
  await removeJobDir(jobId);
  return null;
}

/** حذف کامل یک دانلود از تاریخچه و پاک‌کردن فایل‌های آن */
export async function deleteJob(jobId: string): Promise<boolean> {
  const job = await getJob(jobId);
  if (!job) return false;

  cancelDownload(jobId);
  liveJobs.delete(jobId);
  memJobs.delete(jobId);
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
  if (isDbConfigured) {
    try {
      return await db
        .select()
        .from(downloads)
        .orderBy(desc(downloads.createdAt))
        .limit(limit);
    } catch (e) {
      warnOnce("select", `[jobs] db select failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return [...memJobs.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

export function toPublicJob(row: Download) {
  return {
    jobId: row.jobId,
    title: row.title,
    thumbnail: row.thumbnail,
    uploader: row.uploader,
    duration: row.duration,
    kind: row.kind,
    quality: row.quality,
    status: row.status,
    progress: row.progress,
    fileName: row.fileName,
    fileSize: row.fileSize,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    downloadUrl: row.status === "done" ? `/api/jobs/${row.jobId}/file` : null,
  };
}

export type PublicJob = ReturnType<typeof toPublicJob>;
