import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_BITRATES,
  buildCommonArgs,
  buildDownloadArgs,
  buildVideoFormatSelector,
  cleanYtDlpError,
  mapYtDlpError,
  type YtDlpCapabilities,
} from "../src/lib/ytdlp-args.ts";

const caps: YtDlpCapabilities = {
  version: "2026.08.19",
  supportsJsRuntimes: true,
  supportsRemoteComponents: true,
  isSelfContained: false,
};

test("buildVideoFormatSelector اولویت H.264/mp4 را حفظ می‌کند", () => {
  const selector = buildVideoFormatSelector(1080);
  const parts = selector.split("/");
  assert.match(parts[0], /bestvideo\[height<=1080\]\[ext=mp4\]\[vcodec\^=avc1\]\+bestaudio\[ext=m4a\]/);
  assert.ok(selector.includes("bestvideo[height<=1080]+bestaudio"));
  assert.equal(parts[parts.length - 1], "best");
});

test("buildVideoFormatSelector ارتفاع نامعتبر را اصلاح می‌کند", () => {
  assert.ok(buildVideoFormatSelector(10).includes("height<=144"));
});

test("buildDownloadArgs برای ویدئو ادغام MP4 و faststart را اضافه می‌کند", () => {
  const args = buildDownloadArgs({ kind: "video", quality: 1080, outTemplate: "/tmp/output.%(ext)s" });
  assert.deepEqual(args.slice(0, 4), ["--newline", "--progress", "-o", "/tmp/output.%(ext)s"]);
  assert.ok(args.includes("--merge-output-format"));
  assert.equal(args[args.indexOf("--merge-output-format") + 1], "mp4");
  assert.equal(args[args.indexOf("--postprocessor-args") + 1], "Merger:-movflags +faststart");
  assert.ok(args.includes("-f"));
});

test("buildDownloadArgs برای صدا تبدیل MP3 و متادیتا را تنظیم می‌کند", () => {
  const args = buildDownloadArgs({ kind: "audio", quality: 320, outTemplate: "/tmp/output.%(ext)s" });
  assert.ok(args.includes("-x"));
  assert.equal(args[args.indexOf("--audio-format") + 1], "mp3");
  assert.equal(args[args.indexOf("--audio-quality") + 1], "320K");
  assert.ok(args.includes("--embed-thumbnail"));
  assert.ok(args.includes("--embed-metadata"));
  assert.ok(args.includes("--convert-thumbnails"));
});

test("buildDownloadArgs بیت‌ریت را در بازه‌ی مجاز نگه می‌دارد", () => {
  const args = buildDownloadArgs({ kind: "audio", quality: 9999, outTemplate: "o.%(ext)s" });
  assert.equal(args[args.indexOf("--audio-quality") + 1], "320K");
});

test("لیست بیت‌ریت‌ها فقط یک منبع حقیقت دارد", () => {
  assert.deepEqual([...AUDIO_BITRATES], [320, 256, 192, 160, 128, 96, 64]);
});

test("buildCommonArgs مسیر ffmpeg، کش، کوکی، پراکسی و runtime جاوااسکریپت را اضافه می‌کند", () => {
  const args = buildCommonArgs({
    capabilities: caps,
    nodePath: "/usr/bin/node",
    ffmpegPath: "/usr/bin/ffmpeg",
    cookiesFile: "/app/cookies.txt",
    proxy: "socks5://127.0.0.1:1080",
    extraArgs: "--force-ipv4 --retries 3",
    cacheDir: "/tmp/cache",
    remoteComponents: "ejs:github",
  });
  assert.ok(args.includes("--no-playlist"));
  assert.ok(args.includes("--no-warnings"));
  assert.equal(args[args.indexOf("--ffmpeg-location") + 1], "/usr/bin/ffmpeg");
  assert.equal(args[args.indexOf("--cache-dir") + 1], "/tmp/cache");
  assert.equal(args[args.indexOf("--js-runtimes") + 1], "node:/usr/bin/node");
  assert.equal(args[args.indexOf("--remote-components") + 1], "ejs:github");
  assert.equal(args[args.indexOf("--cookies") + 1], "/app/cookies.txt");
  assert.equal(args[args.indexOf("--proxy") + 1], "socks5://127.0.0.1:1080");
  assert.ok(args.includes("--force-ipv4"));
  assert.ok(args.includes("--retries"));
});

test("buildCommonArgs برای باینری مستقل، remote-components اضافه نمی‌کند", () => {
  const args = buildCommonArgs({
    capabilities: { ...caps, isSelfContained: true },
    nodePath: "/usr/bin/node",
    ffmpegPath: null,
    remoteComponents: null,
  });
  assert.ok(!args.includes("--remote-components"));
  assert.ok(!args.includes("--ffmpeg-location"));
});

test("buildCommonArgs در نسخه‌های قدیمی، آرگومان‌های پشتیبانی‌نشده را اضافه نمی‌کند", () => {
  const args = buildCommonArgs({
    capabilities: { ...caps, supportsJsRuntimes: false, supportsRemoteComponents: false },
    nodePath: "/usr/bin/node",
    ffmpegPath: null,
    remoteComponents: "ejs:github",
  });
  assert.ok(!args.includes("--js-runtimes"));
  assert.ok(!args.includes("--remote-components"));
});

test("cleanYtDlpError پیشوندهای تکراری را حذف می‌کند", () => {
  assert.equal(
    cleanYtDlpError("ERROR: [youtube] dQw4w9WgXcQ: Video unavailable\nsome other line"),
    "Video unavailable",
  );
  assert.equal(cleanYtDlpError("[download] Destination: x"), "[download] Destination: x");
});

test("mapYtDlpError خطاهای رایج را به پیام فارسی تبدیل می‌کند", () => {
  const bot = mapYtDlpError("ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser");
  assert.match(bot, /کوکی/);

  const privateVideo = mapYtDlpError("ERROR: [youtube] abc: Private video. Sign in if you've been granted access");
  assert.match(privateVideo, /خصوصی/);

  const live = mapYtDlpError("ERROR: [youtube] abc: This live event has ended");
  assert.match(live, /پخش زنده/);

  const network = mapYtDlpError("ERROR: Unable to download webpage: <urlopen error timed out>");
  assert.match(network, /ارتباط با یوتیوب|پراکسی/);

  const unknown = mapYtDlpError("ERROR: something totally unexpected happened");
  assert.equal(unknown, "something totally unexpected happened");
});
