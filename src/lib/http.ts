import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { contentDisposition, parseRangeHeader } from "@/lib/files";

export interface FileStreamOptions {
  filePath: string;
  fileName: string;
  mime: string;
  range?: string | null;
  /** فقط هدرها برگردانده شوند (درخواست HEAD) */
  head?: boolean;
  /** نوع Content-Disposition (پیش‌فرض: attachment برای دانلود) */
  disposition?: "attachment" | "inline";
  /** برای آزادکردن فایلِ در حال ارسال وقتی کاربر اتصال را قطع می‌کند */
  signal?: AbortSignal | null;
}

/**
 * ارسال یک فایل از دیسک با پشتیبانی از `Range` (دانلود قابل‌ادامه).
 * در صورت نبود فایل، پاسخ 410 و در صورت بازه‌ی نامعتبر، پاسخ 416 برمی‌گردد.
 */
export async function streamFileResponse(opts: FileStreamOptions): Promise<Response> {
  let size: number;
  try {
    const stat = await fsp.stat(opts.filePath);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch {
    return Response.json({ error: "فایل پیدا نشد یا منقضی شده است." }, { status: 410 });
  }

  const parsed = parseRangeHeader(opts.range, size);
  if (parsed === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  const start = parsed?.start ?? 0;
  const end = parsed?.end ?? Math.max(0, size - 1);
  const status = parsed?.status ?? 200;

  const headers: Record<string, string> = {
    "Content-Type": opts.mime,
    "Content-Disposition": contentDisposition(opts.fileName).replace(
      /^attachment/,
      opts.disposition ?? "attachment",
    ),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  headers["Content-Length"] = String(size === 0 ? 0 : end - start + 1);

  if (opts.head || size === 0) {
    return new Response(null, { status, headers });
  }

  const nodeStream = fs.createReadStream(opts.filePath, { start, end });
  if (opts.signal) {
    const abort = () => nodeStream.destroy();
    if (opts.signal.aborted) abort();
    else opts.signal.addEventListener("abort", abort, { once: true });
    nodeStream.on("close", () => opts.signal?.removeEventListener("abort", abort));
  }

  return new Response(Readable.toWeb(nodeStream) as ReadableStream, { status, headers });
}
