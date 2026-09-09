import {
  bigint,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * جدول تاریخچه دانلودها
 * هر درخواست دانلود (ویدئو یا MP3) یک رکورد در این جدول دارد.
 */
export const downloads = pgTable("downloads", {
  id: serial("id").primaryKey(),
  jobId: varchar("job_id", { length: 64 }).notNull().unique(),
  url: text("url").notNull(),
  videoId: varchar("video_id", { length: 32 }),
  title: text("title"),
  thumbnail: text("thumbnail"),
  uploader: text("uploader"),
  duration: integer("duration"),
  // "video" | "audio"
  kind: varchar("kind", { length: 16 }).notNull(),
  // e.g. "1080p" or "320kbps"
  quality: varchar("quality", { length: 32 }).notNull(),
  // "pending" | "downloading" | "processing" | "done" | "error" | "cancelled" | "expired"
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  progress: integer("progress").notNull().default(0),
  fileName: text("file_name"),
  filePath: text("file_path"),
  fileSize: bigint("file_size", { mode: "number" }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type Download = typeof downloads.$inferSelect;
export type NewDownload = typeof downloads.$inferInsert;
