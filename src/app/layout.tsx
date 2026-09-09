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

export const metadata: Metadata = {
  title: "یوتیوب دانلودر | دانلود ویدئو و MP3 از یوتیوب",
  description:
    "دانلود ویدئوهای یوتیوب با کیفیت‌های مختلف (تا 4K) و تبدیل به MP3 با بیت‌ریت دلخواه — سریع، رایگان و بدون محدودیت.",
  icons: {
    icon: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f0f13",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={vazir.variable}>
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased font-[family-name:var(--font-vazir)]">
        {children}
      </body>
    </html>
  );
}
