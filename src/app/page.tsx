import Link from "next/link";
import Downloader from "@/components/downloader";
import Hero from "@/components/hero";

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-red-500/10 to-transparent"
        aria-hidden
      />

      <main className="relative mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
        <Hero />

        <div className="mb-6 flex justify-center">
          <Link
            href="/preview"
            className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 backdrop-blur transition hover:border-sky-400/40 hover:bg-sky-500/10 hover:text-sky-200"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/20 text-[11px]">🎨</span>
            مشاهدهٔ پیش‌نمایش کامل طراحی (با دادهٔ نمایشی)
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5"
              aria-hidden
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        </div>

        <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
          <Downloader />
        </div>

        <footer className="mt-12 space-y-2 text-center text-xs leading-6 text-slate-500">
          <p>
            این ابزار برای دانلود محتوایی است که حق استفاده از آن را دارید (ویدئوهای خودتان،
            محتوای با مجوز آزاد و…). لطفاً به حقوق پدیدآورندگان و قوانین یوتیوب احترام بگذارید.
          </p>
          <p>
            ساخته‌شده با Next.js · PostgreSQL · yt-dlp · ffmpeg —{" "}
            <Link
              href="/preview"
              className="text-slate-400 underline decoration-dotted underline-offset-4 transition hover:text-sky-300"
            >
              مشاهدهٔ پیش‌نمایش طراحی
            </Link>
          </p>
        </footer>
      </main>
    </div>
  );
}
