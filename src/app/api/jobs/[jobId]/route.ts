import { NextRequest } from "next/server";
import { cancelJob, deleteJob, getJob, toPublicJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** GET /api/jobs/:jobId — وضعیت لحظه‌ای یک دانلود (برای polling از سمت کلاینت) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = await getJob(jobId);
  if (!job) {
    return Response.json({ error: "job پیدا نشد" }, { status: 404 });
  }
  return Response.json({ job: toPublicJob(job) });
}

/**
 * DELETE /api/jobs/:jobId
 * - `?cancel=1`: فقط لغو دانلود (رکورد در تاریخچه می‌ماند).
 * - بدون پارامتر: حذف کامل رکورد و فایل‌های آن.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const onlyCancel = req.nextUrl.searchParams.get("cancel") === "1";

  if (onlyCancel) {
    const error = await cancelJob(jobId);
    if (error) return Response.json({ error }, { status: 409 });
    return Response.json({ ok: true, cancelled: true });
  }

  const removed = await deleteJob(jobId);
  if (!removed) return Response.json({ error: "job پیدا نشد" }, { status: 404 });
  return Response.json({ ok: true, deleted: true });
}
