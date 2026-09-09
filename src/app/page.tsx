import Downloader from "@/components/downloader";

const FEATURES = [
  { icon: "∞", label: "بدون محدودیت حجم" },
  { icon: "🛡️", label: "بدون ثبت‌نام" },
  { icon: "🎞️", label: "ویدئو تا 4K" },
  { icon: "🎧", label: "MP3 تا 320kbps" },
  { icon: "📡", label: "پیشرفت لحظه‌ای" },
];

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-red-500/10 to-transparent"
        aria-hidden
      />

      <main className="relative mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
        <header className="mb-10 text-center animate-fade-up">
          <div className="relative mx-auto mb-5 inline-flex">
            <span
              className="absolute -inset-3 rounded-[1.75rem] bg-red-600/30 blur-2xl animate-pulse-glow"
              aria-hidden
            />
            <div className="animate-float-slow relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-rose-500 text-3xl shadow-2xl shadow-red-900/50 ring-1 ring-white/20">
              <svg viewBox="0 0 24 24" className="h-8 w-8 fill-white" aria-hidden>
                <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
              </svg>
            </div>
          </div>

          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
            یوتیوب <span className="gradient-text">دانلودر</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-400 sm:text-base">
            آدرس ویدئو را وارد کنید؛ کیفیت‌های موجود لیست می‌شود و با یک کلیک ویدئو
            (MP4 تا 4K) یا فایل صوتی MP3 با بیت‌ریت دلخواه را دانلود کنید.
          </p>

          <ul className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-slate-300">
            {FEATURES.map((f) => (
              <li
                key={f.label}
                className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 ring-1 ring-white/10 transition hover:bg-white/10"
              >
                <span aria-hidden>{f.icon}</span>
                {f.label}
              </li>
            ))}
          </ul>
        </header>

        <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
          <Downloader />
        </div>

        <footer className="mt-12 space-y-1 text-center text-xs leading-6 text-slate-500">
          <p>
            این ابزار برای دانلود محتوایی است که حق استفاده از آن را دارید (ویدئوهای خودتان،
            محتوای با مجوز آزاد و…). لطفاً به حقوق پدیدآورندگان و قوانین یوتیوب احترام بگذارید.
          </p>
          <p>ساخته‌شده با Next.js · PostgreSQL · yt-dlp · ffmpeg</p>
        </footer>
      </main>
    </div>
  );
}
