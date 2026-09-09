import { NextRequest } from "next/server";
import { createJob, listJobs, toPublicJob } from "@/lib/jobs";
import { isValidYoutubeUrl } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";

const ALLOWED_AUDIO = [320, 256, 192, 160, 128, 96, 64];

/** لیست آخرین دانلودها (تاریخچه) */
export async function GET() {
  const rows = await listJobs(30);
  return Response.json({ jobs: rows.map(toPublicJob) });
}

/** ایجاد یک job دانلود جدید */
export async function POST(req: NextRequest) {
  let body: {
    url?: string;
    kind?: "video" | "audio";
    quality?: number;
    info?: { id: string; title: string; thumbnail: string | null; uploader: string | null; duration: number | null };
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "بدنه درخواست نامعتبر است" }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  if (!isValidYoutubeUrl(url)) {
    return Response.json({ error: "آدرس یوتیوب نامعتبر است" }, { status: 400 });
  }
  if (body.kind !== "video" && body.kind !== "audio") {
    return Response.json({ error: "نوع دانلود نامعتبر است" }, { status: 400 });
  }
  const quality = Number(body.quality);
  if (!Number.isFinite(quality) || quality <= 0) {
    return Response.json({ error: "کیفیت نامعتبر است" }, { status: 400 });
  }
  if (body.kind === "audio" && !ALLOWED_AUDIO.includes(quality)) {
    return Response.json({ error: "بیت‌ریت انتخابی پشتیبانی نمی‌شود" }, { status: 400 });
  }
  if (body.kind === "video" && (quality < 144 || quality > 4320)) {
    return Response.json({ error: "کیفیت ویدئو نامعتبر است" }, { status: 400 });
  }
  if (!body.info?.id || !body.info?.title) {
    return Response.json({ error: "اطلاعات ویدئو ارسال نشده است" }, { status: 400 });
  }

  try {
    const row = await createJob({
      url,
      kind: body.kind,
      quality,
      info: {
        id: body.info.id,
        title: body.info.title,
        thumbnail: body.info.thumbnail ?? null,
        uploader: body.info.uploader ?? null,
        duration: body.info.duration ?? null,
      },
    });
    return Response.json({ job: toPublicJob(row) }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "خطای ناشناخته";
    console.error("[api/jobs POST]", message);
    return Response.json({ error: `شروع دانلود ناموفق بود: ${message}` }, { status: 500 });
  }
}
