import test from "node:test";
import assert from "node:assert/strict";
import {
  contentDisposition,
  isHttpUrl,
  isPathInside,
  parseRangeHeader,
  pickOutputFile,
  sanitizeFileName,
} from "../src/lib/files.ts";

test("sanitizeFileName کاراکترهای غیرمجاز را حذف می‌کند", () => {
  assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), "abcdefghij");
  assert.equal(sanitizeFileName("  سلام   دنیا  "), "سلام دنیا");
  assert.equal(sanitizeFileName(""), "download");
  assert.equal(sanitizeFileName("   "), "download");
});

test("sanitizeFileName کاراکترهای جهت‌دهی متن (جعل پسوند) را حذف می‌کند", () => {
  // U+202E می‌تواند پسوند واقعی فایل را در نمایش جعل کند
  assert.equal(sanitizeFileName("video\u202egnp.exe"), "videognp.exe");
  assert.equal(sanitizeFileName("a\u200eb"), "ab");
});

test("sanitizeFileName نام‌های رزرو ویندوز و طول زیاد را مدیریت می‌کند", () => {
  assert.equal(sanitizeFileName("CON"), "_CON");
  assert.equal(sanitizeFileName("nul"), "_nul");
  assert.equal(sanitizeFileName("."), "download");
  const long = sanitizeFileName("الف".repeat(300));
  assert.equal([...long].length, 120);
});

test("pickOutputFile فایل نهایی را به فایل‌های موقت ادغام ترجیح می‌دهد", () => {
  assert.equal(pickOutputFile(["output.f137.mp4", "output.f140.m4a", "output.mp4"], "video"), "output.mp4");
  assert.equal(pickOutputFile(["output.mp4"], "video"), "output.mp4");
  assert.equal(pickOutputFile(["output.mp3", "output.webp"], "audio"), "output.mp3");
  assert.equal(pickOutputFile(["output.mp4.part"], "video"), null);
  assert.equal(pickOutputFile([], "video"), null);
});

test("parseRangeHeader بازه‌های استاندارد، پسوندی و نامعتبر را مدیریت می‌کند", () => {
  assert.deepEqual(parseRangeHeader("bytes=0-99", 1000), { start: 0, end: 99, status: 206 });
  assert.deepEqual(parseRangeHeader("bytes=100-", 1000), { start: 100, end: 999, status: 206 });
  assert.deepEqual(parseRangeHeader("bytes=-100", 1000), { start: 900, end: 999, status: 206 });
  assert.deepEqual(parseRangeHeader("bytes=900-5000", 1000), { start: 900, end: 999, status: 206 });
  assert.equal(parseRangeHeader("bytes=5000-6000", 1000), "unsatisfiable");
  assert.equal(parseRangeHeader("items=0-10", 1000), null);
  assert.equal(parseRangeHeader(null, 1000), null);
  assert.equal(parseRangeHeader("bytes=0-99", 0), null);
});

test("contentDisposition نام فارسی را با RFC 5987 کدگذاری می‌کند", () => {
  const header = contentDisposition("ویدئو [1080p].mp4");
  assert.match(header, /^attachment; filename="[^"]*"; filename\*=UTF-8''/);
  assert.ok(!/[\u0600-\u06FF]/.test(header), "هدر نباید کاراکتر غیر ASCII داشته باشد");
  assert.ok(header.includes("%5B1080p%5D"));
});

test("isPathInside از خروج از پوشه جلوگیری می‌کند", () => {
  assert.equal(isPathInside("/tmp/jobs/abc", "/tmp/jobs/abc/output.mp4"), true);
  assert.equal(isPathInside("/tmp/jobs/abc", "/tmp/jobs/abc/../other/output.mp4"), false);
  assert.equal(isPathInside("/tmp/jobs/abc", "/tmp/jobs/abcde/output.mp4"), false);
  assert.equal(isPathInside("/tmp/jobs/abc", "/etc/passwd"), false);
});

test("isHttpUrl فقط آدرس‌های http/https را می‌پذیرد", () => {
  assert.equal(isHttpUrl("https://i.ytimg.com/vi/x/hq.jpg"), true);
  assert.equal(isHttpUrl("http://127.0.0.1:3000/a"), true);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("file:///etc/passwd"), false);
  assert.equal(isHttpUrl("data:image/svg+xml,<svg/>"), false);
  assert.equal(isHttpUrl(42), false);
});
