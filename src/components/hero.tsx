import {
  IconFilm,
  IconMusic,
  IconShield,
  IconSparkles,
  IconActivity,
  IconServer,
} from "@/components/icons";

const FEATURES = [
  { icon: <IconFilm className="h-3.5 w-3.5" />, label: "ویدئو MP4 تا 4K" },
  { icon: <IconMusic className="h-3.5 w-3.5" />, label: "MP3 تا 320kbps" },
  { icon: <IconActivity className="h-3.5 w-3.5" />, label: "پیشرفت لحظه‌ای" },
  { icon: <IconServer className="h-3.5 w-3.5" />, label: "دانلود قابل‌ادامه" },
  { icon: <IconShield className="h-3.5 w-3.5" />, label: "بدون ثبت‌نام" },
];

export default function Hero() {
  return (
    <header className="animate-fade-up mb-10 text-center">
      <div className="relative mx-auto mb-5 inline-flex">
        <span
          className="animate-pulse-glow absolute -inset-4 rounded-[2rem] bg-red-600/25 blur-2xl"
          aria-hidden
        />
        <div className="animate-float-slow relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 via-rose-500 to-red-600 shadow-2xl shadow-red-900/50 ring-1 ring-white/20">
          <svg viewBox="0 0 24 24" className="h-8 w-8 fill-white" aria-hidden>
            <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
          </svg>
        </div>
      </div>

      <span className="animate-fade-up mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300 backdrop-blur">
        <IconSparkles className="h-3.5 w-3.5 text-rose-400" />
        سریع، رایگان و بدون محدودیت حجم
      </span>

      <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-[2.75rem]">
        یوتیوب <span className="gradient-text">دانلودر</span>
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-400 sm:text-base">
        آدرس ویدئو را بچسبانید؛ کیفیت‌های موجود با حجم تقریبی نمایش داده می‌شود و با یک کلیک،
        ویدئو (MP4 تا 4K) یا فایل صوتی MP3 با بیت‌ریت دلخواه را ذخیره می‌کنید.
      </p>

      <ul className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-slate-300">
        {FEATURES.map((feature) => (
          <li
            key={feature.label}
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 transition hover:border-white/20 hover:bg-white/10"
          >
            <span className="text-rose-400" aria-hidden>
              {feature.icon}
            </span>
            {feature.label}
          </li>
        ))}
      </ul>
    </header>
  );
}
