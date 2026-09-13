import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // پکیج‌های باینری نباید توسط bundler پردازش شوند
  serverExternalPackages: ["ffmpeg-static"],

  // هدر X-Powered-By اطلاعات غیرضروری لو می‌دهد
  poweredByHeader: false,

  async headers() {
    return [
      {
        // هدرهای امنیتی پایه برای همه‌ی مسیرها.
        // توجه: عمداً از X-Frame-Options استفاده نشده تا امکان نمایش اپلیکیشن
        // در iframe (پیش‌نمایش/امبد) از بین نرود.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
      {
        // پاسخ‌های API هرگز نباید کش شوند
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
