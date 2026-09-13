# ---------- build stage ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL فقط برای عبور از بررسی زمان build لازم است
ENV DATABASE_URL=postgresql://postgres:postgres@db:5432/app_db
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# فایل‌های موقت دانلود در مسیری قابل‌نوشتن برای کاربر غیر‌روت
ENV DOWNLOAD_DIR=/tmp/yt-downloads
ENV YTDLP_CACHE_DIR=/tmp/yt-dlp-cache

# yt-dlp نسخه‌ی standalone به Python نیاز ندارد؛ ffmpeg سیستمی برای ادغام/تبدیل استفاده می‌شود
ARG YTDLP_RELEASE=latest
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg curl \
  && curl -fL --retry 3 --retry-delay 2 \
       "https://github.com/yt-dlp/yt-dlp/releases/${YTDLP_RELEASE}/download/yt-dlp" \
       -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && yt-dlp --version \
  && rm -rf /var/lib/apt/lists/*

ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg

# کاربر غیر‌روت برای اجرای سرور
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser

COPY --from=builder --chown=appuser:appuser /app/package*.json ./
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appuser /app/.next ./.next
COPY --from=builder --chown=appuser:appuser /app/public ./public
COPY --from=builder --chown=appuser:appuser /app/next.config.ts ./
COPY --from=builder --chown=appuser:appuser /app/drizzle.config.ts ./
COPY --from=builder --chown=appuser:appuser /app/src/db ./src/db

RUN mkdir -p /tmp/yt-downloads /tmp/yt-dlp-cache \
  && chown -R appuser:appuser /tmp/yt-downloads /tmp/yt-dlp-cache

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

# ابتدا جدول‌ها ساخته می‌شوند (با DATABASE_URL از compose) سپس سرور بالا می‌آید
CMD ["sh", "-c", "npx drizzle-kit push --force || echo '[docker] drizzle-kit push انجام نشد؛ ادامه با تاریخچه‌ی غیرفعال' ; exec npm run start"]
