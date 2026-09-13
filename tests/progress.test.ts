import test from "node:test";
import assert from "node:assert/strict";
import {
  DownloadProgressTracker,
  isValidEta,
  parseFormatCount,
  parseYtDlpSize,
  parseYtDlpSpeed,
  isPostProcessLine,
} from "../src/lib/progress.ts";

test("parseYtDlpSize واحدهای دودویی و اعشاری را می‌فهمد", () => {
  assert.equal(parseYtDlpSize("102.40MiB"), 107_374_182);
  assert.equal(parseYtDlpSize("1.5GiB"), 1_610_612_736);
  assert.equal(parseYtDlpSize("512KiB"), 524_288);
  assert.equal(parseYtDlpSize("2MB"), 2_000_000);
  assert.equal(parseYtDlpSize("~ 6.32MiB"), 6_627_000);
  assert.equal(parseYtDlpSize("Unknown"), undefined);
  assert.equal(parseYtDlpSize(null), undefined);
});

test("parseYtDlpSpeed سرعت را به بایت بر ثانیه تبدیل می‌کند", () => {
  assert.equal(parseYtDlpSpeed("5.21MiB/s"), 5_463_081);
  assert.equal(parseYtDlpSpeed("228.15KiB/s"), 233_626);
  assert.equal(parseYtDlpSpeed("Unknown B/s"), undefined);
});

test("isValidEta فقط قالب زمان را قبول می‌کند", () => {
  assert.equal(isValidEta("00:11"), true);
  assert.equal(isValidEta("01:02:03"), true);
  assert.equal(isValidEta("Unknown"), false);
  assert.equal(isValidEta(undefined), false);
});

test("parseFormatCount تعداد استریم‌های ادغامی را درست می‌شمارد", () => {
  // yt-dlp همیشه «1 format(s)» می‌نویسد اما دو استریم دانلود می‌کند
  assert.equal(parseFormatCount("[info] dQw4w9WgXcQ: Downloading 1 format(s): 137+140"), 2);
  assert.equal(parseFormatCount("[info] dQw4w9WgXcQ: Downloading 1 format(s): 22"), 1);
  assert.equal(parseFormatCount("[info] dQw4w9WgXcQ: Downloading 1 format(s): 243+251+140"), 3);
  assert.equal(parseFormatCount("[download] Destination: /tmp/output.mp4"), null);
});

test("isPostProcessLine خطوط ادغام/تبدیل را تشخیص می‌دهد", () => {
  assert.equal(isPostProcessLine('[Merger] Merging formats into "/tmp/output.mp4"'), true);
  assert.equal(isPostProcessLine("[ExtractAudio] Destination: /tmp/output.mp3"), true);
  assert.equal(isPostProcessLine("[download] Destination: /tmp/output.mp4"), false);
});

test("پیشرفت دانلود یک فرمت مستقل تا ۱۰۰٪ می‌رود", () => {
  const tracker = new DownloadProgressTracker("video");
  tracker.handleLine("[info] abc: Downloading 1 format(s): 22");
  const first = tracker.handleLine("[download]   4.0% of  100.00MiB at  5.00MiB/s ETA 00:19");
  assert.ok(first);
  assert.equal(first.phase, "downloading");
  assert.equal(first.percent, 4);
  assert.equal(first.totalBytes, 104_857_600);
  assert.equal(first.speed, "5.00MiB/s");
  assert.equal(first.eta, "00:19");

  const done = tracker.handleLine("[download] 100% of  100.00MiB in 00:19 at 5.01MiB/s");
  assert.ok(done);
  assert.equal(done.phase, "downloading");
  assert.ok(done.percent >= 95);
});

test("پیشرفت دانلود ادغامی هرگز عقب نمی‌رود و درست به پایان می‌رسد", () => {
  // دنباله‌ی واقعی خطوط yt-dlp برای `-f 137+140`
  const lines = [
    "[info] testvideo: Downloading 1 format(s): 137+140",
    "[download] Destination: /tmp/out/output.f137.mp4",
    "[download]   0.0% of    6.20MiB at  Unknown B/s ETA Unknown",
    "[download]  25.0% of    6.20MiB at  10.00MiB/s ETA 00:01",
    "[download]  50.0% of    6.20MiB at  10.00MiB/s ETA 00:01",
    "[download] 100% of    6.20MiB in 00:01 at 10.00MiB/s",
    "[download] Destination: /tmp/out/output.f140.m4a",
    "[download]   0.0% of  128.00KiB at  Unknown B/s ETA Unknown",
    "[download]  50.0% of  128.00KiB at   2.00MiB/s ETA 00:00",
    "[download] 100% of  128.00KiB in 00:00 at 2.00MiB/s",
    '[Merger] Merging formats into "/tmp/out/output.mp4"',
  ];

  const tracker = new DownloadProgressTracker("video");
  let previous = -1;
  const seen: number[] = [];
  for (const line of lines) {
    const metrics = tracker.handleLine(line);
    if (!metrics) continue;
    assert.ok(
      metrics.percent >= previous,
      `پیشرفت عقب رفت: ${previous} → ${metrics.percent} (خط: ${line})`,
    );
    previous = metrics.percent;
    seen.push(metrics.percent);
  }

  const final = tracker.handleLine('[Merger] Merging formats into "/tmp/out/output.mp4"');
  const lastPercent = final?.percent ?? previous;
  assert.ok(lastPercent >= 95, `پیشرفت نهایی کم است: ${lastPercent}`);
  assert.ok(seen.length > 0);
});

test("حالت صدا برای تبدیل، بخشی از درصد را کنار می‌گذارد", () => {
  const tracker = new DownloadProgressTracker("audio");
  tracker.handleLine("[info] abc: Downloading 1 format(s): 140");
  const mid = tracker.handleLine("[download] 100% of  128.00KiB in 00:00 at 2.00MiB/s");
  assert.ok(mid && mid.percent <= 90, "درصد دانلود صدا نباید از سهم تبدیل جلو بزند");

  const processing = tracker.handleLine("[ExtractAudio] Destination: /tmp/out/output.mp3");
  assert.ok(processing);
  assert.equal(processing.phase, "processing");
  assert.ok(processing.percent >= 90 && processing.percent <= 99);
});

test("خطوط بی‌ربط نادیده گرفته می‌شوند", () => {
  const tracker = new DownloadProgressTracker("video");
  assert.equal(tracker.handleLine("[youtube] Extracting URL: https://youtu.be/x"), null);
  assert.equal(tracker.handleLine(""), null);
});
