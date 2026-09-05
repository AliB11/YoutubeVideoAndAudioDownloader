import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Vazirmatn } from "next/font/google";
import "./globals.css";

const vazir = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-vazir",
  display: "swap",
});

export const metadata: Metadata = {
  title: "یوتیوب دانلودر | دانلود ویدئو و MP3 از یوتیوب",
  description:
    "دانلود ویدئوهای یوتیوب با کیفیت‌های مختلف (تا 4K) و تبدیل به MP3 با بیت‌ریت دلخواه — سریع، رایگان و بدون محدودیت.",
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
