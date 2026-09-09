import { defineConfig } from "drizzle-kit";

/**
 * پیکربندی drizzle-kit
 * مقدار DATABASE_URL از متغیر محیطی خوانده می‌شود (drizzle-kit خودش فایل .env را هم load می‌کند)
 * تا هم در اجرای محلی و هم داخل Docker (hostname: db) درست کار کند.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  },
});
