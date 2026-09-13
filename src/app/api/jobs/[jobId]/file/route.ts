import { NextRequest } from "next/server";
import { getJob } from "@/lib/jobs";
import { jobDir } from "@/lib/ytdlp";
import { isPathInside } from "@/lib/files";
import { streamFileResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest, params: Promise<{ jobId: string }>, head: boolean) {
  const { jobId } = await params;
  const job = await getJob(jobId);

  if (!job) return Response.json({ error: "job پیدا نشد" }, { status: 404 });
  if (job.status !== "done" || !job.filePath) {
    return Response.json({ error: "فایل هنوز آماده نیست" }, { status: 409 });
  }

  // لایه‌ی دفاعی: فایل فقط از داخل پوشه‌ی همان job قابل ارسال است
  if (!isPathInside(jobDir(jobId), job.filePath)) {
    console.error("[api/jobs/file] مسیر فایل خارج از پوشه‌ی job است", job.filePath);
    return Response.json({ error: "مسیر فایل نامعتبر است" }, { status: 500 });
  }

  const extension = job.kind === "video" ? "mp4" : "mp3";
  return streamFileResponse({
    filePath: job.filePath,
    fileName: job.fileName || `download.${extension}`,
    mime: job.kind === "video" ? "video/mp4" : "audio/mpeg",
    range: req.headers.get("range"),
    head,
    signal: req.signal,
  });
}

/** GET /api/jobs/:jobId/file — ارسال فایل نهایی به مرورگر (با پشتیبانی Range) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  return handle(req, params, false);
}

/** HEAD /api/jobs/:jobId/file — بررسی وجود و اندازه‌ی فایل بدون دانلود آن */
export async function HEAD(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  return handle(req, params, true);
}
