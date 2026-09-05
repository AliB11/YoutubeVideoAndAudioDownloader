import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { getJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, "%2A");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** ارسال فایل نهایی به مرورگر کاربر */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = await getJob(jobId);

  if (!job) return Response.json({ error: "job پیدا نشد" }, { status: 404 });
  if (job.status !== "done" || !job.filePath) {
    return Response.json({ error: "فایل هنوز آماده نیست" }, { status: 409 });
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(job.filePath);
  } catch {
    return Response.json(
      { error: "فایل منقضی شده است. لطفاً دوباره دانلود کنید." },
      { status: 410 },
    );
  }

  const total = stat.size;
  const mime = job.kind === "video" ? "video/mp4" : "audio/mpeg";
  const fileName = job.fileName ?? `download.${job.kind === "video" ? "mp4" : "mp3"}`;

  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(fileName),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  const range = req.headers.get("range");
  let start = 0;
  let end = total - 1;
  let status = 200;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1]) start = parseInt(m[1], 10);
      if (m[2]) end = parseInt(m[2], 10);
      if (!m[1] && m[2]) {
        start = Math.max(0, total - parseInt(m[2], 10));
        end = total - 1;
      }
      if (start >= total || end >= total || start > end) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
    }
  }

  headers["Content-Length"] = String(end - start + 1);

  const nodeStream = fs.createReadStream(job.filePath, { start, end });
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new Response(webStream, { status, headers });
}
