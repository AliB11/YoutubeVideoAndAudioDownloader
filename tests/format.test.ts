import test from "node:test";
import assert from "node:assert/strict";
import { faNum, formatBytes, formatDuration, formatRelative, formatViews } from "../src/lib/format.ts";

test("formatBytes حجم را با واحد مناسب نشان می‌دهد", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(6_305_309), "6.0 MB");
  assert.equal(formatBytes(1_980_000_000), "1.8 GB");
  assert.equal(formatBytes(null), "—");
  assert.equal(formatBytes(0), "—");
});

test("formatDuration زمان را درست قالب‌بندی می‌کند", () => {
  assert.equal(formatDuration(45), "0:45");
  assert.equal(formatDuration(212), "3:32");
  assert.equal(formatDuration(3725), "1:02:05");
  assert.equal(formatDuration(null), "—");
});

test("formatViews بازدید را کوتاه می‌کند", () => {
  assert.equal(formatViews(999), "999");
  assert.equal(formatViews(1500), "1.5K");
  assert.equal(formatViews(1_234_567), "1.2M");
  assert.equal(formatViews(2_000_000_000), "2.0B");
  assert.equal(formatViews(null), "—");
});

test("faNum ارقام را فارسی می‌کند", () => {
  assert.equal(faNum(123), "۱۲۳");
  assert.equal(faNum("45%"), "۴۵%");
});

test("formatRelative زمان نسبی را با ارقام فارسی برمی‌گرداند", () => {
  assert.equal(formatRelative(new Date(Date.now() - 10_000)), "چند لحظه پیش");
  assert.equal(formatRelative(new Date(Date.now() - 5 * 60_000)), "۵ دقیقه پیش");
  assert.equal(formatRelative(new Date(Date.now() - 3 * 3_600_000)), "۳ ساعت پیش");
  assert.equal(formatRelative(new Date(Date.now() - 2 * 86_400_000)), "۲ روز پیش");
});
