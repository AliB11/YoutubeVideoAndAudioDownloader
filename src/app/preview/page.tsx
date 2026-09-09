import type { Metadata } from "next";
import Downloader from "@/components/downloader";
import Hero from "@/components/hero";

export const metadata: Metadata = {
  title: "پیش‌نمایش طراحی | یوتیوب دانلودر",
  robots: { index: false, follow: false },
};

export default function PreviewPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-red-500/10 to-transparent"
        aria-hidden
      />

      <main className="relative mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
        <Hero />

        <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
          <Downloader demo />
        </div>
      </main>
    </div>
  );
}
