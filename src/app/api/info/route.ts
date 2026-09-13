import { NextRequest } from "next/server";
import { fetchVideoInfo, isValidYoutubeUrl } from "@/lib/ytdlp";
import { isDemoMode } from "@/lib/demo-source";
import { checkRateLimit, clientKey, RATE_LIMIT_PER_MINUTE } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /api/info — استخراج اطلاعات و کیفیت‌های یک ویدئو */
export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`info:${clientKey(req.headers)}`, RATE_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return Response.json(
      { error: "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "بدنه درخواست نامعتبر است" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || !isValidYoutubeUrl(url)) {
    return Response.json({ error: "لطفاً یک آدرس معتبر یوتیوب وارد کنید" }, { status: 400 });
  }

  try {
    const info = await fetchVideoInfo(url);
    return Response.json({ info, demo: isDemoMode() });
  } catch (e) {
    const message = e instanceof Error ? e.message : "خطای ناشناخته";
    console.error("[api/info]", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
