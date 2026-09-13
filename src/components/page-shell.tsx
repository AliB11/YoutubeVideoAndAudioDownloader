import type { ReactNode } from "react";

/** پوسته‌ی مشترک صفحات (پس‌زمینه‌ی گرادیانی + شبکه‌ی محو + ناحیه‌ی محتوا) */
export default function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-red-500/10 via-transparent to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-32 top-24 h-80 w-80 rounded-full bg-red-500/5 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-32 top-64 h-80 w-80 rounded-full bg-sky-500/5 blur-3xl"
        aria-hidden
      />
      <main className="relative mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">{children}</main>
    </div>
  );
}
