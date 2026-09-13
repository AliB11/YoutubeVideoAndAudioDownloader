import { NextRequest } from "next/server";
import { demoMime, ensureDemoMedia, isDemoMode, type DemoKind } from "@/lib/demo-source";
import { streamFileResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/demo/media?kind=video|audio
 *
 * در «حالت نمایشی» (DEMO_MODE=1) یک کلیپ نمونه‌ی محلی را به‌عنوان منبع دانلود
 * برای yt-dlp سرو می‌کند. خارج از حالت نمایشی، این مسیر وجود ندارد.
 */
export async function GET(req: NextRequest) {
  if (!isDemoMode()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const kindParam = req.nextUrl.searchParams.get("kind");
  const kind: DemoKind =
    kindParam === "audio" ? "audio" : kindParam === "thumbnail" ? "thumbnail" : "video";

  try {
    const file = await ensureDemoMedia(kind);
    return streamFileResponse({
      filePath: file,
      fileName: `demo-${kind}`,
      mime: demoMime(kind),
      range: req.headers.get("range"),
      signal: req.signal,
      disposition: kind === "thumbnail" ? "inline" : "attachment",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "خطای ناشناخته";
    console.error("[api/demo/media]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
