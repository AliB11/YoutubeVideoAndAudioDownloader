import { sql } from "drizzle-orm";
import { db, isDbConfigured } from "@/db";
import { ensureInitialized, getQueueStatus } from "@/lib/jobs";
import { getToolchainStatus } from "@/lib/toolchain";
import { isDemoMode } from "@/lib/demo-source";

export const dynamic = "force-dynamic";

/** GET /api/health — وضعیت دیتابیس، ابزارهای سیستمی و صف دانلود */
export async function GET() {
  await ensureInitialized();

  const dbStatus = await (async () => {
    if (!isDbConfigured) return "disabled" as const;
    try {
      await db.execute(sql`select 1`);
      return "up" as const;
    } catch {
      return "down" as const;
    }
  })();

  const tools = await getToolchainStatus();
  const ok = dbStatus !== "down";

  return Response.json(
    {
      ok,
      demo: isDemoMode(),
      db: dbStatus,
      tools: {
        ytdlp: tools.ytdlp.available,
        ytdlpVersion: tools.ytdlp.version,
        ytdlpSource: tools.ytdlp.source,
        ffmpeg: tools.ffmpeg.available,
        ffmpegVersion: tools.ffmpeg.version,
      },
      queue: getQueueStatus(),
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
