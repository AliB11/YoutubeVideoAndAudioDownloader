import Downloader from "@/components/downloader";

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
      <header className="mb-10 text-center">
        <div className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-rose-500 text-3xl shadow-2xl shadow-red-900/50">
          ▶
        </div>
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
          یوتیوب دانلودر
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-400 sm:text-base">
          آدرس ویدئو را وارد کنید؛ کیفیت‌های موجود لیست می‌شود و با یک کلیک ویدئو (MP4 تا 4K) یا
          فایل صوتی MP3 با بیت‌ریت دلخواه را دانلود کنید.
        </p>
        <ul className="mt-5 flex flex-wrap justify-center gap-2 text-xs text-slate-300">
          {["بدون محدودیت حجم", "بدون ثبت‌نام", "ویدئو تا 4K", "MP3 تا 320kbps", "نمایش پیشرفت لحظه‌ای"].map(
            (t) => (
              <li key={t} className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">
                {t}
              </li>
            ),
          )}
        </ul>
      </header>

      <Downloader />

      <footer className="mt-12 text-center text-xs leading-6 text-slate-500">
        <p>
          این ابزار برای دانلود محتوایی است که حق استفاده از آن را دارید (ویدئوهای خودتان، محتوای با
          مجوز آزاد و…). لطفاً به حقوق پدیدآورندگان و قوانین یوتیوب احترام بگذارید.
        </p>
        <p className="mt-1">
          ساخته‌شده با Next.js · PostgreSQL · yt-dlp · ffmpeg
        </p>
      </footer>
    </main>
  );
}
