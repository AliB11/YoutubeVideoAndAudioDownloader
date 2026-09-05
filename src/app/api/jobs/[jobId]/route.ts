import { NextRequest } from "next/server";
import { getJob, toPublicJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** وضعیت لحظه‌ای یک job (برای polling از سمت کلاینت) */
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
