#!/usr/bin/env node
/**
 * سازنده‌ی آیکون ویندوز (app.ico) بدون هیچ وابستگی خارجی.
 *
 * - آیکون را به‌صورت برنامه‌ای (procedural) رسم می‌کند: مربع گوشه‌گرد با گرادیان قرمز/رز
 *   و مثلث پخش سفید (هماهنگ با public/icon.svg).
 * - خروجی یک فایل ICO استاندارد با تصاویر BMP (DIB 32bpp) در اندازه‌های 16 تا 256 پیکسل است
 *   که Inno Setup و ویندوز بدون مشکل می‌خوانند.
 * - با سوییچ --preview یک PNG هم می‌سازد (برای بررسی چشمی طراحی آیکون).
 *
 * استفاده:
 *   node make-icon.mjs ../../assets/app.ico
 *   node make-icon.mjs ../../assets/app.ico --preview /tmp/preview.png
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SIZES = [16, 24, 32, 48, 64, 128, 256];

/* ------------------------------- رسم آیکون ------------------------------- */

const hex = (h) => [
  Number.parseInt(h.slice(1, 3), 16),
  Number.parseInt(h.slice(3, 5), 16),
  Number.parseInt(h.slice(5, 7), 16),
];
const FROM = hex("#ff2d55");
const TO = hex("#f43f5e");
const DARK = hex("#7f1d2f");

/** فاصله‌ی نقطه از مستطیل گوشه‌گرد (برای پوشش ضدلبه) */
function roundedRectCoverage(x, y, w, h, r, inset) {
  const left = inset;
  const top = inset;
  const right = w - inset;
  const bottom = h - inset;
  const radius = Math.min(r, (right - left) / 2, (bottom - top) / 2);
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dist = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, radius - dist + 0.5));
}

/** پوشش داخل مثلث (روش نیم‌صفحه‌ای) */
function triangleCoverage(px, py, a, b, c) {
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([px, py], a, b);
  const d2 = sign([px, py], b, c);
  const d3 = sign([px, py], c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return hasNeg && hasPos ? 0 : 1;
}

const SAMPLES = 3; // نمونه‌برداری ۳×۳ برای لبه‌های نرم

/** رندر آیکون در اندازه‌ی مشخص → بافر RGBA (top-down) */
function render(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const radius = size * 0.22;
  const inset = size * 0.03;

  // مثلث پخش (نسبت‌های مشابه آیکون اصلی)
  const tri = [
    [size * 0.40, size * 0.29],
    [size * 0.73, size * 0.5],
    [size * 0.40, size * 0.71],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgCoverage = 0;
      let triCoverage = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const fx = x + (sx + 0.5) / SAMPLES;
          const fy = y + (sy + 0.5) / SAMPLES;
          bgCoverage += roundedRectCoverage(fx, fy, size, size, radius, inset);
          triCoverage += triangleCoverage(fx, fy, tri[0], tri[1], tri[2]);
        }
      }
      bgCoverage /= SAMPLES * SAMPLES;
      triCoverage /= SAMPLES * SAMPLES;

      // گرادیان قطری + کمی تیره‌تر شدن در پایین برای عمق
      const t = Math.min(1, Math.max(0, (x / size) * 0.35 + (y / size) * 0.65));
      let r = FROM[0] + (TO[0] - FROM[0]) * t;
      let g = FROM[1] + (TO[1] - FROM[1]) * t;
      let b = FROM[2] + (TO[2] - FROM[2]) * t;
      r = r * (1 - t * 0.12) + DARK[0] * t * 0.12;
      g = g * (1 - t * 0.12) + DARK[1] * t * 0.12;
      b = b * (1 - t * 0.12) + DARK[2] * t * 0.12;

      // مثلث سفید روی پس‌زمینه
      r = r * (1 - triCoverage) + 255 * triCoverage;
      g = g * (1 - triCoverage) + 255 * triCoverage;
      b = b * (1 - triCoverage) + 255 * triCoverage;

      const alpha = Math.round(bgCoverage * 255);
      const i = (y * size + x) * 4;
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = alpha;
    }
  }
  return px;
}

/* ------------------------------ کدگذاری ICO ------------------------------ */

/** یک تصویر BMP (DIB) با عمق ۳۲ بیت + ماسک AND صفر */
function encodeDibIcon(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // اندازه‌ی BITMAPINFOHEADER
  header.writeInt32LE(size, 4); // عرض
  header.writeInt32LE(size * 2, 8); // ارتفاع = XOR + AND
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bit count
  header.writeUInt32LE(0, 16); // بدون فشرده‌سازی
  header.writeUInt32LE(size * size * 4, 20);

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    // BMP از پایین به بالا ذخیره می‌شود
    const srcRow = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }

  // ماسک AND: هر سطر به مضرب ۴ بایت گرد می‌شود
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskRowBytes * size);

  return Buffer.concat([header, xor, and]);
}

function encodeIco(images) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // نوع: آیکون
  dir.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + entries.length;
  images.forEach((image, index) => {
    const base = index * 16;
    entries.writeUInt8(image.size >= 256 ? 0 : image.size, base);
    entries.writeUInt8(image.size >= 256 ? 0 : image.size, base + 1);
    entries.writeUInt8(0, base + 2); // تعداد رنگ‌ها
    entries.writeUInt8(0, base + 3);
    entries.writeUInt16LE(1, base + 4); // planes
    entries.writeUInt16LE(32, base + 6); // bit count
    entries.writeUInt32LE(image.data.length, base + 8);
    entries.writeUInt32LE(offset, base + 12);
    offset += image.data.length;
  });

  return Buffer.concat([dir, entries, ...images.map((i) => i.data)]);
}

/* ------------------------- کدگذاری PNG (فقط پیش‌نمایش) ------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // فیلتر None
    rgba.subarray(y * size * 4, (y + 1) * size * 4).forEach((v, i) => {
      raw[y * (size * 4 + 1) + 1 + i] = v;
    });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --------------------------------- اجرا --------------------------------- */

const args = process.argv.slice(2);
const outPath = args.find((a) => !a.startsWith("--")) ?? path.join("assets", "app.ico");
const previewIndex = args.indexOf("--preview");
const previewPath = previewIndex >= 0 ? args[previewIndex + 1] : null;

const images = SIZES.map((size) => ({ size, data: encodeDibIcon(render(size), size) }));
const ico = encodeIco(images);

mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
writeFileSync(outPath, ico);
console.log(`✅ آیکون ساخته شد: ${outPath} (${(ico.length / 1024).toFixed(1)} کیلوبایت، ${SIZES.join("/")} پیکسل)`);

if (previewPath) {
  const preview = encodePng(render(256), 256);
  mkdirSync(path.dirname(path.resolve(previewPath)), { recursive: true });
  writeFileSync(previewPath, preview);
  console.log(`🖼  پیش‌نمایش PNG: ${previewPath}`);
}
