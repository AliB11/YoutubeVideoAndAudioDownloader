import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { downloads, type Download } from "@/db/schema";
import { removeJobDir, runDownload, type VideoInfo } from "@/lib/ytdlp";

/** مدت نگهداری فایل‌های دانلود‌شده روی سرور (میلی‌ثانیه) */
const FILE_TTL_MS = Number(process.env.FILE_TTL_MINUTES ?? 120) * 60 * 1000;

interface LiveJob {
  progress: number;
  status: Download["status"];
  lastDbWrite: number;
}

const globalForJobs = globalThis as typeof globalThis & {
  __ytLiveJobs?: Map<string, LiveJob>;
  __ytCleanupTimer?: NodeJS.Timeout;
};

const liveJobs = (globalForJobs.__ytLiveJobs ??= new Map<string, LiveJob>());

function ensureCleanupTimer() {
  if (globalForJobs.__ytCleanupTimer) return;
  globalForJobs.__ytCleanupTimer = setInterval(() => {
    cleanupExpired().catch((e) => console.error("[jobs] cleanup failed", e));
  }, 5 * 60 * 1000);
  globalForJobs.__ytCleanupTimer.unref?.();
}

export async function cleanupExpired() {
  const cutoff = new Date(Date.now() - FILE_TTL_MS);
  const expired = await db
    .select({ id: downloads.id, jobId: downloads.jobId })
    .from(downloads)
    .where(and(lt(downloads.createdAt, cutoff), inArray(downloads.status, ["done", "error"])));

  for (const row of expired) {
    await removeJobDir(row.jobId);
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
}

export interface CreateJobInput {
  url: string;
  kind: "video" | "audio";
  quality: number;
  info: Pick<VideoInfo, "id" | "title" | "thumbnail" | "uploader" | "duration">;
}

export async function createJob(input: CreateJobInput): Promise<Download> {
  ensureCleanupTimer();
  const jobId = randomUUID();
  const qualityLabel = input.kind === "video" ? `${input.quality}p` : `${input.quality}kbps`;
  const ext = input.kind === "video" ? "mp4" : "mp3";
  const safeTitle = (input.info.title || "download")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const fileName = `${safeTitle} [${qualityLabel}].${ext}`;

  const [row] = await db
    .insert(downloads)
    .values({
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
    })
    .returning();

  liveJobs.set(jobId, { progress: 0, status: "downloading", lastDbWrite: 0 });

  const persist = async (patch: Partial<typeof downloads.$inferInsert>) => {
    await db.update(downloads).set(patch).where(eq(downloads.jobId, jobId)).catch((e) => {
      console.error("[jobs] db update failed", e);
    });
  };

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
          void persist({ progress, status });
        }
      },
      onDone: (filePath, fileSize) => {
        liveJobs.set(jobId, { progress: 100, status: "done", lastDbWrite: Date.now() });
        void persist({
          progress: 100,
          status: "done",
          filePath,
          fileSize,
          completedAt: new Date(),
        });
      },
      onError: (message) => {
        liveJobs.set(jobId, { progress: 0, status: "error", lastDbWrite: Date.now() });
        void persist({ status: "error", error: message, completedAt: new Date() });
      },
    },
  ).catch((e) => {
    const message = e instanceof Error ? e.message : String(e);
    liveJobs.set(jobId, { progress: 0, status: "error", lastDbWrite: Date.now() });
    void persist({ status: "error", error: message, completedAt: new Date() });
  });

  return row;
}

export async function getJob(jobId: string): Promise<Download | null> {
  const [row] = await db.select().from(downloads).where(eq(downloads.jobId, jobId)).limit(1);
  if (!row) return null;
  const live = liveJobs.get(jobId);
  if (live && row.status !== "done" && row.status !== "error") {
    return { ...row, progress: live.progress, status: live.status };
  }
  return row;
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
