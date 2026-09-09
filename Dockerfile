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

# yt-dlp نسخه‌ی standalone به Python نیاز ندارد، اما ffmpeg سیستمی سریع‌تر است
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg curl \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/src/db ./src/db

EXPOSE 3000
# ابتدا جدول‌ها ساخته می‌شوند (با DATABASE_URL از compose) سپس سرور بالا می‌آید
CMD ["sh", "-c", "npx drizzle-kit push && npm run start"]
