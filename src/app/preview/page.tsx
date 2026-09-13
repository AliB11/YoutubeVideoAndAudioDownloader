import type { Metadata } from "next";
import Downloader from "@/components/downloader";
import Hero from "@/components/hero";
import PageShell from "@/components/page-shell";

export const metadata: Metadata = {
  title: "پیش‌نمایش طراحی",
  description: "پیش‌نمایش رابط کاربری با داده‌های نمایشی (بدون نیاز به سرور دانلود).",
  robots: { index: false, follow: false },
};

export default function PreviewPage() {
  return (
    <PageShell>
      <Hero />

      <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <Downloader demo />
      </div>
    </PageShell>
  );
}
