import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

/**
 * آیا PostgreSQL تنظیم شده است؟
 * اگر `DATABASE_URL` وجود نداشته باشد، اپلیکیشن همچنان کار می‌کند اما تاریخچه‌ی
 * دانلودها ذخیره نمی‌شود (دانلود و تبدیل همچنان فعال است).
 */
export const isDbConfigured = Boolean(process.env.DATABASE_URL?.trim());

const globalForDb = globalThis as typeof globalThis & {
  __ytDownloaderPool?: Pool;
};

function createPool(connectionString: string, options: PoolConfig = {}): Pool {
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
    ...options,
  });

  // بدون این هندلر، خطای یک کلاینت بی‌کار (مثلاً ری‌استارت شدن دیتابیس)
  // به‌صورت رخداد 'error' مدیریت‌نشده باعث از کار افتادن کل سرور می‌شود.
  pool.on("error", (error) => {
    console.error("[db] unexpected pool error:", error.message);
  });

  return pool;
}

/** کلاینت واقعی؛ فقط زمانی ساخته می‌شود که DATABASE_URL تنظیم شده باشد */
export const pool: Pool | null = isDbConfigured
  ? (globalForDb.__ytDownloaderPool ??= createPool(process.env.DATABASE_URL!, {
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      // کوئری‌های طولانی روی دیتابیس نمی‌توانند درخواست‌های وب را قفل کنند
      statement_timeout: 15_000,
    }))
  : null;

/**
 * کلاینت Drizzle. اگر دیتابیس تنظیم نشده باشد، یک pool ساختگیِ هرگز-متصل‌شونده
 * ساخته می‌شود تا فراخوانی‌های ناخواسته به‌جای crash، خطای معمولی بدهند.
 */
export const db = drizzle(
  pool ??
    createPool("postgresql://127.0.0.1:1/unused", {
      max: 1,
      connectionTimeoutMillis: 1000,
    }),
);

if (!isDbConfigured) {
  console.warn(
    "[db] DATABASE_URL تنظیم نشده است — تاریخچه‌ی دانلودها غیرفعال خواهد بود. " +
      "برای فعال‌سازی، DATABASE_URL را در فایل .env تنظیم کنید.",
  );
}
