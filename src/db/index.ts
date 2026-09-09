import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * آیا PostgreSQL تنظیم شده است؟
 * اگر DATABASE_URL وجود نداشته باشد، اپلیکیشن همچنان کار می‌کند اما تاریخچه‌ی
 * دانلودها ذخیره نمی‌شود (دانلود و تبدیل همچنان فعال است).
 */
export const isDbConfigured = Boolean(process.env.DATABASE_URL);

const globalForDb = globalThis as typeof globalThis & {
  __ytDownloaderPool?: Pool;
};

export const pool =
  globalForDb.__ytDownloaderPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/unused",
    max: 5,
    connectionTimeoutMillis: 3000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__ytDownloaderPool = pool;
}

export const db = drizzle(pool);

if (!isDbConfigured) {
  console.warn(
    "[db] DATABASE_URL تنظیم نشده است — تاریخچه‌ی دانلودها غیرفعال خواهد بود. " +
      "برای فعال‌سازی، DATABASE_URL را در فایل .env تنظیم کنید.",
  );
}
