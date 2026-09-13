import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";

const vazir = localFont({
  src: "./fonts/Vazirmatn[wght].woff2",
  weight: "100 900",
  variable: "--font-vazir",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "یوتیوب دانلودر | دانلود ویدئو و MP3 از یوتیوب",
    template: "%s | یوتیوب دانلودر",
  },
  description:
    "دانلود ویدئوهای یوتیوب با کیفیت‌های مختلف (تا 4K) و تبدیل به MP3 با بیت‌ریت دلخواه — سریع، رایگان و بدون محدودیت.",
  applicationName: "یوتیوب دانلودر",
  keywords: ["یوتیوب", "دانلود ویدئو", "دانلود MP3", "yt-dlp", "دانلودر یوتیوب"],
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    type: "website",
    locale: "fa_IR",
    siteName: "یوتیوب دانلودر",
    title: "یوتیوب دانلودر | دانلود ویدئو و MP3 از یوتیوب",
    description:
      "دانلود ویدئوهای یوتیوب تا کیفیت 4K و ساخت فایل MP3 با بیت‌ریت دلخواه، همراه با پیشرفت لحظه‌ای.",
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "یوتیوب دانلودر",
    description: "دانلود ویدئو (MP4 تا 4K) و MP3 از یوتیوب با پیشرفت لحظه‌ای.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#06060b" },
    { media: "(prefers-color-scheme: light)", color: "#06060b" },
  ],
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={vazir.variable}>
      <body className="min-h-screen bg-slate-950 font-[family-name:var(--font-vazir)] text-slate-100 antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:right-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          پرش به محتوای اصلی
        </a>
        <div id="main-content">{children}</div>
      </body>
    </html>
  );
}
