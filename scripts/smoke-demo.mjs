#!/usr/bin/env node
/**
 * آزمون دود (smoke test) سرتاسری سامانه در «حالت نمایشی».
 *
 * پیش‌نیاز: سرور با DEMO_MODE=1 در حال اجرا باشد و yt-dlp/ffmpeg در دسترس باشند.
 *
 *   DEMO_MODE=1 YTDLP_PATH=/path/to/yt-dlp FFMPEG_PATH=/path/to/ffmpeg npm run dev
 *   node scripts/smoke-demo.mjs
 */
const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const TEST_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

let failures = 0;

function log(ok, message) {
  console.log(`${ok ? "✅" : "❌"} ${message}`);
  if (!ok) failures += 1;
}

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function waitForJob(jobId, timeoutMs = 120_000) {
  const startedAt = Date.now();
  const seen = [];
  while (Date.now() - startedAt < timeoutMs) {
    const { res, body } = await json(`/api/jobs/${jobId}`);
    if (!res.ok) throw new Error(`وضعیت job خوانده نشد (${res.status})`);
    const job = body.job;
    const last = seen[seen.length - 1];
    if (!last || last.percent !== job.progress || last.status !== job.status) {
      seen.push({ percent: job.progress, status: job.status });
      console.log(
        `   … ${job.status} ${job.progress}%${job.speed ? ` @ ${job.speed}` : ""}${job.eta ? ` ETA ${job.eta}` : ""}`,
      );
    }
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") return { job, seen };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("زمان انتظار برای پایان دانلود تمام شد");
}

async function main() {
  console.log(`\n🔎 آزمون سامانه روی ${BASE}\n`);

  const { res: healthRes, body: health } = await json("/api/health");
  log(healthRes.ok, `health: ${JSON.stringify(health)}`);
  log(health.demo === true, "حالت نمایشی فعال است (DEMO_MODE=1)");
  log(health.tools?.ytdlp === true, "yt-dlp در دسترس است");
  log(health.tools?.ffmpeg === true, "ffmpeg در دسترس است");

  const { res: infoRes, body: infoBody } = await json("/api/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: TEST_URL }),
  });
  const info = infoBody.info;
  log(infoRes.ok && Boolean(info), "اطلاعات ویدئو دریافت شد");
  log(Array.isArray(info?.videoQualities) && info.videoQualities.length > 0, "کیفیت‌های ویدئو لیست شد");
  log(Array.isArray(info?.audioQualities) && info.audioQualities.length === 7, "کیفیت‌های MP3 لیست شد");

  const { res: badRes } = await json("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/watch?v=1", kind: "video", quality: 720 }),
  });
  log(badRes.status === 400, "آدرس غیر‌یوتیوبی رد می‌شود");

  /* ------------------------------- دانلود ویدئو ------------------------------ */
  const videoQuality = info.videoQualities[info.videoQualities.length - 1];
  const { res: jobRes, body: jobBody } = await json("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: TEST_URL,
      kind: "video",
      quality: videoQuality.height,
      info: {
        id: info.id,
        title: info.title,
        thumbnail: info.thumbnail,
        uploader: info.uploader,
        duration: info.duration,
      },
    }),
  });
  log(jobRes.status === 201 && Boolean(jobBody.job), `job ویدئو ساخته شد (${videoQuality.label})`);

  const { res: dupRes, body: dupBody } = await json("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: TEST_URL,
      kind: "video",
      quality: videoQuality.height,
      info: { id: info.id, title: info.title, thumbnail: info.thumbnail, uploader: info.uploader, duration: info.duration },
    }),
  });
  log(dupRes.status === 200 && dupBody.reused === true, "دانلود تکراری تشخیص داده شد و job جدید ساخته نشد");

  const { job: videoJob, seen } = await waitForJob(jobBody.job.jobId);
  log(videoJob.status === "done", `دانلود ویدئو تمام شد (${videoJob.status})`);
  log(seen.some((s) => s.percent > 0 && s.percent < 100), "پیشرفت میانی گزارش شد");

  const headRes = await fetch(`${BASE}${videoJob.downloadUrl}`, { method: "HEAD" });
  log(headRes.status === 200, "درخواست HEAD برای فایل کار می‌کند");
  const total = Number(headRes.headers.get("content-length") ?? 0);
  log(total > 10_000, `اندازه‌ی فایل گزارش شد (${total} بایت)`);

  const rangeRes = await fetch(`${BASE}${videoJob.downloadUrl}`, { headers: { Range: "bytes=0-1023" } });
  const rangeBody = new Uint8Array(await rangeRes.arrayBuffer());
  log(rangeRes.status === 206 && rangeBody.byteLength === 1024, "پاسخ Range با کد ۲۰۶ و طول درست برگشت");

  const fileRes = await fetch(`${BASE}${videoJob.downloadUrl}`);
  const fileBuf = new Uint8Array(await fileRes.arrayBuffer());
  const isMp4 = String.fromCharCode(...fileBuf.slice(4, 8)) === "ftyp";
  log(isMp4 && fileBuf.byteLength === total, "فایل دریافتی یک MP4 سالم است");

  /* -------------------------------- دانلود MP3 ------------------------------- */
  const { res: audioRes, body: audioBody } = await json("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: TEST_URL,
      kind: "audio",
      quality: 192,
      info: { id: info.id, title: info.title, thumbnail: info.thumbnail, uploader: info.uploader, duration: info.duration },
    }),
  });
  log(audioRes.status === 201, "job صوتی ساخته شد");

  const { job: audioJob, seen: audioSeen } = await waitForJob(audioBody.job.jobId);
  log(audioJob.status === "done", `تبدیل MP3 تمام شد (${audioJob.status})`);
  log(
    audioSeen.some((s) => s.status === "processing"),
    "مرحله‌ی تبدیل (processing) گزارش شد",
  );

  const mp3Res = await fetch(`${BASE}${audioJob.downloadUrl}`);
  const mp3 = new Uint8Array(await mp3Res.arrayBuffer());
  const isMp3 =
    (mp3[0] === 0x49 && mp3[1] === 0x44 && mp3[2] === 0x33) || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0);
  log(isMp3, "فایل دریافتی یک MP3 سالم است");

  /* ---------------------------------- لغو ---------------------------------- */
  const { body: cancelBody } = await json("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: TEST_URL,
      kind: "video",
      quality: videoQuality.height === 360 ? 480 : 360,
      info: { id: info.id, title: info.title, thumbnail: info.thumbnail, uploader: info.uploader, duration: info.duration },
    }),
  });
  const cancelRes = await fetch(`${BASE}/api/jobs/${cancelBody.job.jobId}?cancel=1`, { method: "DELETE" });
  log(cancelRes.ok, "درخواست لغو دانلود پذیرفته شد");
  const { job: cancelledJob } = await waitForJob(cancelBody.job.jobId, 60_000);
  log(cancelledJob.status === "cancelled", `وضعیت نهایی «لغو شده» ثبت شد (${cancelledJob.status})`);

  const delRes = await fetch(`${BASE}/api/jobs/${cancelBody.job.jobId}`, { method: "DELETE" });
  log(delRes.ok, "حذف رکورد از تاریخچه انجام شد");

  console.log(`\n${failures === 0 ? "🎉 همه‌ی بررسی‌ها موفق بود" : `⚠️ ${failures} بررسی ناموفق`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n❌ خطای غیرمنتظره:", error);
  process.exit(1);
});
