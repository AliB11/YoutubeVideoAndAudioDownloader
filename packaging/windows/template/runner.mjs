#!/usr/bin/env node
/**
 * لانچر «یوتیوب دانلودر» برای ویندوز (و لینوکس/مک برای آزمون).
 *
 * کارهایی که انجام می‌دهد:
 *  ۱) فایل `.env` کنار خودش را می‌خواند (بدون نیاز به هیچ کتابخانه‌ای).
 *  ۲) اگر سرویس قبلاً در حال اجرا باشد، فقط مرورگر را باز می‌کند (بدون اجرای نسخه‌ی دوم).
 *  ۳) یک پورت آزاد انتخاب می‌کند (پیش‌فرض ۳۰۰۰) و سرور Next.js را روی 127.0.0.1 اجرا می‌کند.
 *  ۴) خروجی سرور را در کنسول و در `data/logs/server.log` می‌نویسد.
 *  ۵) پس از آماده‌شدن سرویس، مرورگر را باز می‌کند.
 *  ۶) با بستن پنجره/Ctrl+C کل درخت فرایند (شامل yt-dlp و ffmpeg) بسته می‌شود.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, createWriteStream, openSync, closeSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const IS_WINDOWS = process.platform === "win32";
const DATA_DIR = path.join(ROOT, "data");
const LOG_DIR = path.join(DATA_DIR, "logs");
const STATE_FILE = path.join(DATA_DIR, "server.json");
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

/* --------------------------------- نمایش ---------------------------------- */

const fa = (n) => String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

function banner(port) {
  const url = `http://127.0.0.1:${port}`;
  const line = "─".repeat(58);
  console.log(`\n${line}`);
  console.log("  🎬  یوتیوب دانلودر — سرویس محلی در حال اجراست");
  console.log(`  🌐  آدرس برنامه:      ${url}`);
  console.log(`  📁  پوشه‌ی فایل‌ها:     ${path.join(DATA_DIR, "downloads")}`);
  console.log(`  📝  گزارش سرور:       ${path.join(LOG_DIR, "server.log")}`);
  console.log("  ⏹  برای بستن سرویس:   Ctrl+C یا بستن همین پنجره");
  console.log(`${line}\n`);
}

/* ---------------------------------- .env ---------------------------------- */

function loadEnvFile() {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined && value.trim() !== "") process.env[key] = value;
  }
}

/* ------------------------------ پورت و سرویس ------------------------------ */

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function pickPort(preferred) {
  for (let port = preferred; port < preferred + 25; port++) {
    if (await portAvailable(port)) return port;
  }
  throw new Error(`هیچ پورت آزادی در بازه‌ی ${preferred} تا ${preferred + 24} پیدا نشد.`);
}

function readState() {
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (state && Number.isInteger(state.pid) && Number.isInteger(state.port)) return state;
  } catch {
    /* فایل وضعیت وجود ندارد یا خراب است */
  }
  return null;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function healthOk(port, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function openBrowser(url) {
  try {
    if (IS_WINDOWS) spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true });
    else if (process.platform === "darwin") spawnSync("open", [url], { stdio: "ignore" });
    else spawnSync("xdg-open", [url], { stdio: "ignore" });
  } catch {
    console.log(`ℹ️  مرورگر به‌صورت خودکار باز نشد؛ دستی به این آدرس بروید: ${url}`);
  }
}

/* --------------------------------- اجرا ---------------------------------- */

async function main() {
  if (!existsSync(NEXT_BIN)) {
    console.error("❌ فایل‌های برنامه پیدا نشد (.next / node_modules). بسته را دوباره از حالت فشرده خارج کنید.");
    process.exit(1);
  }

  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(path.join(DATA_DIR, "downloads"), { recursive: true });
  mkdirSync(path.join(DATA_DIR, "cache"), { recursive: true });
  loadEnvFile();

  // اگر سرویس از قبل در حال اجراست، فقط مرورگر را باز کن
  const previous = readState();
  if (previous && pidAlive(previous.pid) && (await healthOk(previous.port))) {
    console.log(`ℹ️  سرویس از قبل در حال اجراست (پورت ${fa(previous.port)}).`);
    openBrowser(`http://127.0.0.1:${previous.port}`);
    return;
  }

  const preferred = Number.parseInt(process.env.PORT ?? "3000", 10);
  const port = await pickPort(Number.isFinite(preferred) ? preferred : 3000);

  const toolsDir = path.join(ROOT, "tools");
  const ytdlp = path.join(toolsDir, IS_WINDOWS ? "yt-dlp.exe" : "yt-dlp");
  const ffmpeg = path.join(toolsDir, IS_WINDOWS ? "ffmpeg.exe" : "ffmpeg");

  const env = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    DOWNLOAD_DIR: process.env.DOWNLOAD_DIR || path.join(DATA_DIR, "downloads"),
    YTDLP_CACHE_DIR: process.env.YTDLP_CACHE_DIR || path.join(DATA_DIR, "cache"),
    ...(existsSync(ytdlp) ? { YTDLP_PATH: process.env.YTDLP_PATH || ytdlp } : {}),
    ...(existsSync(ffmpeg) ? { FFMPEG_PATH: process.env.FFMPEG_PATH || ffmpeg } : {}),
  };

  const logFile = path.join(LOG_DIR, "server.log");
  const logStream = createWriteStream(logFile, { flags: "a" });
  logStream.write(`\n===== ${new Date().toISOString()} — اجرا روی پورت ${port} =====\n`);

  const child = spawn(process.execPath, [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  writeFileSync(
    STATE_FILE,
    JSON.stringify({ pid: child.pid, port, startedAt: new Date().toISOString() }, null, 2),
  );

  const cleanup = (exitCode = 0) => {
    try {
      if (child.pid && !child.killed) {
        if (IS_WINDOWS) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        else child.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
    try {
      rmSync(STATE_FILE, { force: true });
      logStream.end();
    } catch {
      /* ignore */
    }
    process.exit(exitCode);
  };

  process.on("SIGINT", () => cleanup(0));
  process.on("SIGTERM", () => cleanup(0));
  process.on("SIGHUP", () => cleanup(0));
  child.on("exit", (code) => cleanup(code ?? 0));
  child.on("error", (error) => {
    console.error("❌ اجرای سرور ناموفق بود:", error.message);
    cleanup(1);
  });

  // انتظار برای آماده‌شدن سرویس
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await healthOk(port)) {
      banner(port);
      openBrowser(`http://127.0.0.1:${port}`);
      return;
    }
    if (child.exitCode !== null) {
      console.error("❌ سرور پیش از آماده‌شدن متوقف شد؛ فایل data/logs/server.log را بررسی کنید.");
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error("❌ سرویس در زمان مورد انتظار آماده نشد؛ فایل data/logs/server.log را بررسی کنید.");
}

main().catch((error) => {
  console.error("❌ خطای غیرمنتظره:", error);
  process.exit(1);
});
