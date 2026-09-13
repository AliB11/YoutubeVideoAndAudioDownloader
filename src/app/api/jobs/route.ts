import { NextRequest } from "next/server";
import { createJob, getQueueStatus, isAllowedAudioBitrate, listJobs, toPublicJob } from "@/lib/jobs";
import { isValidYoutubeUrl } from "@/lib/ytdlp";
import { isDemoMode } from "@/lib/demo-source";
import { checkRateLimit, clientKey, RATE_LIMIT_PER_MINUTE } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_TITLE_LENGTH = 500;

interface ParsedInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  uploader: string | null;
  duration: number | null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  // کاراکترهای کنترلی و جهت‌دهی متن حذف می‌شوند (نام فایل و نمایش امن بماند)
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function parseInfo(input: unknown): ParsedInfo | string {
  if (typeof input !== "object" || input === null) return "اطلاعات ویدئو ارسال نشده است";
  const raw = input as Record<string, unknown>;
  const id = cleanText(raw.id, 32);
  const title = cleanText(raw.title, MAX_TITLE_LENGTH);
  if (!id || !title) return "اطلاعات ویدئو ارسال نشده است";

  const uploader = cleanText(raw.uploader, 200);
  const duration =
    typeof raw.duration === "number" && Number.isFinite(raw.duration) && raw.duration > 0
      ? Math.round(raw.duration)
      : null;

  let thumbnail: string | null = null;
  const thumb = cleanText(raw.thumbnail, 2048);
  if (thumb) {
    try {
      const url = new URL(thumb);
      if (url.protocol === "https:" || url.protocol === "http:") thumbnail = thumb;
    } catch {
      thumbnail = null;
    }
  }

  return { id, title, thumbnail, uploader, duration };
}

/** GET /api/jobs — تاریخچه‌ی دانلودها */
export async function GET() {
  const rows = await listJobs(30);
  return Response.json({ jobs: rows.map(toPublicJob), queue: getQueueStatus() });
}

/** POST /api/jobs — ساخت یک دانلود جدید */
export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`jobs:${clientKey(req.headers)}`, RATE_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return Response.json(
      { error: "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "بدنه درخواست نامعتبر است" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!isValidYoutubeUrl(url)) {
    return Response.json({ error: "آدرس یوتیوب نامعتبر است" }, { status: 400 });
  }

  const kind = body.kind;
  if (kind !== "video" && kind !== "audio") {
    return Response.json({ error: "نوع دانلود نامعتبر است" }, { status: 400 });
  }

  const quality = Number(body.quality);
  if (!Number.isInteger(quality) || quality <= 0) {
    return Response.json({ error: "کیفیت نامعتبر است" }, { status: 400 });
  }
  if (kind === "audio" && !isAllowedAudioBitrate(quality)) {
    return Response.json({ error: "بیت‌ریت انتخابی پشتیبانی نمی‌شود" }, { status: 400 });
  }
  if (kind === "video" && (quality < 144 || quality > 4320)) {
    return Response.json({ error: "کیفیت ویدئو نامعتبر است" }, { status: 400 });
  }

  const info = parseInfo(body.info);
  if (typeof info === "string") {
    return Response.json({ error: info }, { status: 400 });
  }

  try {
    const { job, reused } = await createJob({ url, kind, quality, info });
    return Response.json(
      { job: toPublicJob(job), demo: isDemoMode(), reused },
      { status: reused ? 200 : 201 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "خطای ناشناخته";
    console.error("[api/jobs POST]", message);
    return Response.json({ error: `شروع دانلود ناموفق بود: ${message}` }, { status: 500 });
  }
}
