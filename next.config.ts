import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // پکیج‌های باینری نباید توسط bundler پردازش شوند
  serverExternalPackages: ["yt-dlp-wrap", "ffmpeg-static"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.ytimg.com" },
      { protocol: "https", hostname: "**.googleusercontent.com" },
      { protocol: "https", hostname: "**.ggpht.com" },
    ],
  },
};

export default nextConfig;
