"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import type { AudioQuality, VideoInfo, VideoQuality } from "@/lib/ytdlp";
import type { PublicJob } from "@/lib/jobs";
import { faNum, formatBytes, formatDuration, formatRelative, formatViews } from "@/lib/format";
import { demoActiveJobs, demoHistory, demoInfo } from "@/lib/demo";

type Tab = "video" | "audio";

const YT_REGEX =
  /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\/.+/i;

export default function Downloader({ demo = false }: { demo?: boolean }) {
  const [tab, setTab] = useState<Tab>("video");
  const [url, setUrl] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [info, setInfo] = useState<VideoInfo | null>(demo ? demoInfo : null);
  const [infoError, setInfoError] = useState<string | null>(null);

  const [activeJobs, setActiveJobs] = useState<PublicJob[]>(demo ? demoActiveJobs : []);
  const [history, setHistory] = useState<PublicJob[]>(demo ? demoHistory : []);
  const autoDownloaded = useRef<Set<string>>(new Set());

  /* ---------------------------- تاریخچه دانلودها ---------------------------- */
  const loadHistory = useCallback(async () => {
    if (demo) return;
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: PublicJob[] };
      setHistory(data.jobs);
    } catch {
      /* ignore */
    }
  }, [demo]);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/jobs", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { jobs: PublicJob[] };
        if (!cancelled) setHistory(data.jobs);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo]);

  /* ------------------------------ polling jobها ------------------------------ */
  useEffect(() => {
    if (demo) return;
    const pending = activeJobs.filter(
      (j) => j.status !== "done" && j.status !== "error" && j.status !== "cancelled",
    );
    if (pending.length === 0) return;

    const timer = setInterval(async () => {
      const updates = await Promise.all(
        pending.map(async (j) => {
          try {
            const res = await fetch(`/api/jobs/${j.jobId}`, { cache: "no-store" });
            if (!res.ok) return null;
            const data = (await res.json()) as { job: PublicJob };
            return data.job;
          } catch {
            return null;
          }
        }),
      );
      let anyFinished = false;
      setActiveJobs((prev) =>
        prev.map((j) => {
          const u = updates.find((x) => x && x.jobId === j.jobId);
          if (!u) return j;
          if ((u.status === "done" || u.status === "error") && j.status !== u.status) {
            anyFinished = true;
          }
          return u;
        }),
      );
      for (const u of updates) {
        if (u && u.status === "done" && u.downloadUrl && !autoDownloaded.current.has(u.jobId)) {
          autoDownloaded.current.add(u.jobId);
          triggerBrowserDownload(u.downloadUrl);
        }
      }
      if (anyFinished) void loadHistory();
    }, 1000);

    return () => clearInterval(timer);
  }, [activeJobs, loadHistory, demo]);

  /* ------------------------------ دریافت اطلاعات ------------------------------ */
  const fetchInfo = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = url.trim();
    if (!YT_REGEX.test(trimmed)) {
      setInfoError("لطفاً یک آدرس معتبر یوتیوب وارد کنید (مثلاً https://youtu.be/...)");
      return;
    }
    setLoadingInfo(true);
    setInfoError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = (await res.json()) as { info?: VideoInfo; error?: string };
      if (!res.ok || !data.info) {
        setInfoError(data.error ?? "خطایی رخ داد");
        return;
      }
      setInfo(data.info);
    } catch {
      setInfoError("ارتباط با سرور برقرار نشد");
    } finally {
      setLoadingInfo(false);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        setInfoError(null);
        setInfo(null);
      }
    } catch {
      /* ignore */
    }
  };

  const clearUrl = () => {
    setUrl("");
    setInfo(null);
    setInfoError(null);
  };

  /* -------------------------------- شروع دانلود -------------------------------- */
  const startJob = async (kind: Tab, quality: number) => {
    if (!info) return;
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: info.webpageUrl,
          kind,
          quality,
          info: {
            id: info.id,
            title: info.title,
            thumbnail: info.thumbnail,
            uploader: info.uploader,
            duration: info.duration,
          },
        }),
      });
      const data = (await res.json()) as { job?: PublicJob; error?: string };
      if (!res.ok || !data.job) {
        setInfoError(data.error ?? "شروع دانلود ناموفق بود");
        return;
      }
      setActiveJobs((prev) => [data.job!, ...prev]);
    } catch {
      setInfoError("ارتباط با سرور برقرار نشد");
    }
  };

  const isJobRunning = (kind: Tab, quality: string) =>
    activeJobs.some(
      (j) =>
        j.kind === kind &&
        j.quality === quality &&
        info &&
        j.title === info.title &&
        j.status !== "done" &&
        j.status !== "error" &&
        j.status !== "cancelled",
    );

  /* ------------------------------ لغو و حذف job ------------------------------ */
  const cancelJob = async (jobId: string) => {
    setActiveJobs((prev) =>
      prev.map((j) => (j.jobId === jobId ? { ...j, status: "cancelled" as const, progress: 0 } : j)),
    );
    if (demo) return;
    try {
      await fetch(`/api/jobs/${jobId}?cancel=1`, { method: "DELETE" });
    } catch {
      /* polling یا بازخوانی تاریخچه وضعیت واقعی را همگام می‌کند */
    }
    void loadHistory();
  };

  const deleteJob = async (jobId: string) => {
    // بازخورد فوری در UI؛ در صورت خطا polling/تاریخچه آن را برمی‌گرداند
    setActiveJobs((prev) => prev.filter((j) => j.jobId !== jobId));
    setHistory((prev) => prev.filter((j) => j.jobId !== jobId));
    if (demo) return;
    try {
      await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
    void loadHistory();
  };

  return (
    <div className="space-y-6">
      {demo && (
        <div className="flex flex-col items-start justify-between gap-2 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200 sm:flex-row sm:items-center">
          <span className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/20 text-xs">🎨</span>
            حالت پیش‌نمایش — همه‌ی داده‌ها نمایشی هستند و دکمه‌ها فقط برای دیدن طراحی فعال‌اند.
          </span>
          <Link href="/" className="shrink-0 rounded-lg border border-sky-500/30 px-3 py-1.5 text-xs font-semibold transition hover:bg-sky-500/10">
            بازگشت به اپلیکیشن
          </Link>
        </div>
      )}

      {/* ------------------------------- تب‌ها ------------------------------- */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-900/70 p-1.5 ring-1 ring-white/10 backdrop-blur">
        <TabButton active={tab === "video"} onClick={() => setTab("video")} icon={<IconFilm />}>
          دانلود ویدئو
        </TabButton>
        <TabButton active={tab === "audio"} onClick={() => setTab("audio")} icon={<IconMusic />}>
          دانلود MP3
        </TabButton>
      </div>

      {/* ------------------------------ فرم آدرس ------------------------------ */}
      <form
        onSubmit={fetchInfo}
        className="rounded-2xl bg-slate-900/70 p-4 ring-1 ring-white/10 shadow-2xl shadow-black/40 backdrop-blur sm:p-5"
      >
        <label htmlFor="url" className="mb-2 block text-sm text-slate-300">
          {tab === "video"
            ? "آدرس ویدئوی یوتیوب را وارد کنید تا کیفیت‌های موجود لیست شود"
            : "آدرس ویدئوی یوتیوب را وارد کنید تا کیفیت‌های MP3 لیست شود"}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              <IconLink />
            </span>
            <input
              id="url"
              dir="ltr"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-xl border border-white/10 bg-slate-950/80 py-3 pl-10 pr-9 text-left text-slate-100 placeholder:text-slate-500 outline-none ring-red-500/40 transition focus:border-red-500/60 focus:ring-4"
            />
            {url && (
              <button
                type="button"
                onClick={clearUrl}
                title="پاک کردن"
                aria-label="پاک کردن"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
              >
                <IconX />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={pasteFromClipboard}
              title="چسباندن از کلیپ‌بورد"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            >
              <IconClipboard className="h-4 w-4" />
              <span className="hidden md:inline">چسباندن</span>
            </button>
            <button
              type="submit"
              disabled={loadingInfo}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-red-600 to-rose-500 px-6 py-3 font-semibold text-white shadow-lg shadow-red-900/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingInfo ? (
                <>
                  <Spinner /> در حال بررسی…
                </>
              ) : (
                <>
                  <IconSearch className="h-4 w-4" />
                  بررسی لینک
                </>
              )}
            </button>
          </div>
        </div>
        {infoError && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {infoError}
          </p>
        )}
      </form>

      {/* ------------------------------ کارت ویدئو ------------------------------ */}
      {loadingInfo && <InfoSkeleton />}
      {info && !loadingInfo && (
        <section className="animate-fade-up overflow-hidden rounded-2xl bg-slate-900/70 ring-1 ring-white/10 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
            <div className="group relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-slate-800 sm:w-64">
              {info.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={info.thumbnail}
                  alt={info.title}
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-600">
                  <IconFilm className="h-10 w-10" />
                </div>
              )}
              <span className="absolute bottom-2 left-2 rounded-md bg-black/80 px-1.5 py-0.5 text-xs text-white tabular">
                {faNum(formatDuration(info.duration))}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-lg font-bold leading-relaxed text-white">
                {info.title}
              </h2>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                {info.uploader && (
                  <MetaChip icon={<IconUser className="h-3.5 w-3.5" />}>{info.uploader}</MetaChip>
                )}
                {info.viewCount != null && (
                  <MetaChip icon={<IconEye className="h-3.5 w-3.5" />}>
                    {faNum(formatViews(info.viewCount))} بازدید
                  </MetaChip>
                )}
                {info.sourceAudioBitrate ? (
                  <MetaChip icon={<IconMusic className="h-3.5 w-3.5" />}>
                    صدای اصلی ~{info.sourceAudioBitrate} kbps
                  </MetaChip>
                ) : null}
              </div>
              <a
                href={info.webpageUrl}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                className="mt-3 inline-flex max-w-full items-center gap-1 truncate text-left text-xs text-sky-400 hover:underline"
              >
                <IconExternal className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{info.webpageUrl}</span>
              </a>
            </div>
          </div>

          <div className="border-t border-white/10 p-4 sm:p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-300">
              {tab === "video"
                ? "کیفیت ویدئو را انتخاب کنید (MP4)"
                : "کیفیت فایل MP3 را انتخاب کنید"}
            </h3>

            {tab === "video" ? (
              <QualityGrid>
                {info.videoQualities.length === 0 && (
                  <p className="col-span-full rounded-xl border border-white/5 bg-slate-950/40 px-4 py-6 text-center text-sm text-slate-400">
                    کیفیت ویدئویی برای این لینک یافت نشد.
                  </p>
                )}
                {info.videoQualities.map((q, i) => (
                  <VideoQualityButton
                    key={q.height + (q.fps ?? 0)}
                    q={q}
                    recommended={i === 0}
                    busy={isJobRunning("video", `${q.height}p`)}
                    onClick={() => startJob("video", q.height)}
                  />
                ))}
              </QualityGrid>
            ) : (
              <QualityGrid>
                {info.audioQualities.map((q, i) => (
                  <AudioQualityButton
                    key={q.bitrate}
                    q={q}
                    recommended={i === 0}
                    busy={isJobRunning("audio", `${q.bitrate}kbps`)}
                    onClick={() => startJob("audio", q.bitrate)}
                  />
                ))}
              </QualityGrid>
            )}
          </div>
        </section>
      )}

      {/* ------------------------------ دانلودهای فعال ------------------------------ */}
      {activeJobs.length > 0 && (
        <section className="animate-fade-up rounded-2xl bg-slate-900/70 p-4 ring-1 ring-white/10 backdrop-blur sm:p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
            <IconActivity className="h-4 w-4 text-red-400" />
            دانلودهای این نشست
          </h3>
          <ul className="space-y-3">
            {activeJobs.map((j) => (
              <JobRow key={j.jobId} job={j} onCancel={cancelJob} onDelete={deleteJob} />
            ))}
          </ul>
        </section>
      )}

      {/* --------------------------------- تاریخچه --------------------------------- */}
      <section className="rounded-2xl bg-slate-900/50 p-4 ring-1 ring-white/10 backdrop-blur sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <IconClock className="h-4 w-4" />
            تاریخچه دانلودها
          </h3>
          <button
            onClick={() => void loadHistory()}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 transition hover:text-slate-200"
          >
            <IconRefresh className="h-3.5 w-3.5" />
            بروزرسانی
          </button>
        </div>
        {history.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
            <IconDownload className="mx-auto mb-2 h-8 w-8 text-slate-600" />
            <p className="text-sm text-slate-500">هنوز دانلودی ثبت نشده است.</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {history.map((j) => (
              <HistoryRow key={j.jobId} job={j} onDelete={deleteJob} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Sub components                               */
/* -------------------------------------------------------------------------- */

function triggerBrowserDownload(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${
        active
          ? "bg-gradient-to-l from-red-600 to-rose-500 text-white shadow-lg shadow-red-900/40"
          : "text-slate-300 hover:bg-white/5"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function MetaChip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 ring-1 ring-white/10">
      <span className="text-slate-400">{icon}</span>
      {children}
    </span>
  );
}

function QualityGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

function RecommendedBadge() {
  return (
    <span className="absolute -top-2.5 left-3 rounded-full bg-gradient-to-l from-red-600 to-rose-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-lg shadow-red-900/40">
      پیشنهادی
    </span>
  );
}

function VideoQualityButton({
  q,
  busy,
  recommended,
  onClick,
}: {
  q: VideoQuality;
  busy: boolean;
  recommended: boolean;
  onClick: () => void;
}) {
  const tier =
    q.height >= 2160
      ? "4K"
      : q.height >= 1440
        ? "2K"
        : q.height >= 1080
          ? "Full HD"
          : q.height >= 720
            ? "HD"
            : "SD";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`group relative flex flex-col items-start gap-1.5 rounded-xl border p-3 text-right transition disabled:cursor-wait disabled:opacity-60 ${
        recommended
          ? "border-red-500/50 bg-red-500/10 hover:border-red-400"
          : "border-white/10 bg-slate-950/60 hover:border-red-500/60 hover:bg-red-500/5"
      }`}
    >
      {recommended && !busy && <RecommendedBadge />}
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-lg font-bold text-white tabular">{q.label}</span>
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
          {tier}
        </span>
      </div>
      <span className="text-xs text-slate-400 tabular">
        MP4 · {formatBytes(q.filesize)}
        {q.fps ? ` · ${q.fps}fps` : ""}
        {!q.hasAudio ? " · + صدا" : ""}
      </span>
      <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-red-400 group-hover:text-red-300">
        {busy ? (
          <>
            <Spinner className="h-3.5 w-3.5" /> در حال دانلود…
          </>
        ) : (
          <>
            <IconDownload className="h-3.5 w-3.5" />
            {recommended ? "دانلود با بهترین کیفیت" : "دانلود"}
          </>
        )}
      </span>
    </button>
  );
}

function AudioQualityButton({
  q,
  busy,
  recommended,
  onClick,
}: {
  q: AudioQuality;
  busy: boolean;
  recommended: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`group relative flex flex-col items-start gap-1.5 rounded-xl border p-3 text-right transition disabled:cursor-wait disabled:opacity-60 ${
        recommended
          ? "border-emerald-500/50 bg-emerald-500/10 hover:border-emerald-400"
          : "border-white/10 bg-slate-950/60 hover:border-emerald-500/60 hover:bg-emerald-500/5"
      }`}
    >
      {recommended && !busy && (
        <span className="absolute -top-2.5 left-3 rounded-full bg-gradient-to-l from-emerald-500 to-teal-400 px-2 py-0.5 text-[10px] font-bold text-emerald-950 shadow-lg shadow-emerald-900/40">
          پیشنهادی
        </span>
      )}
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-lg font-bold text-white tabular">{q.label}</span>
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
          MP3
        </span>
      </div>
      <span className="text-xs text-slate-400 tabular">
        {q.tag} · ~{formatBytes(q.filesize)}
      </span>
      <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 group-hover:text-emerald-300">
        {busy ? (
          <>
            <Spinner className="h-3.5 w-3.5" /> در حال تبدیل…
          </>
        ) : (
          <>
            <IconDownload className="h-3.5 w-3.5" />
            {recommended ? "دانلود با بالاترین کیفیت" : "دانلود"}
          </>
        )}
      </span>
    </button>
  );
}

function statusLabel(j: PublicJob) {
  switch (j.status) {
    case "downloading":
      return "در حال دانلود از یوتیوب";
    case "processing":
      return j.kind === "audio" ? "در حال تبدیل به MP3" : "در حال ادغام ویدئو و صدا";
    case "done":
      return "آماده دانلود";
    case "error":
      return "خطا";
    case "cancelled":
      return "لغو شده";
    case "expired":
      return "منقضی شده";
    default:
      return "در صف";
  }
}

function JobRow({
  job,
  onCancel,
  onDelete,
}: {
  job: PublicJob;
  onCancel: (jobId: string) => void;
  onDelete: (jobId: string) => void;
}) {
  const running = job.status === "downloading" || job.status === "processing";
  const accent = job.kind === "video" ? "bg-red-500" : "bg-emerald-500";
  return (
    <li className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
      <div className="flex items-start gap-3">
        <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-md bg-slate-800">
          {job.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={job.thumbnail} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{job.title}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {job.kind === "video" ? "🎬 MP4" : "🎵 MP3"} · {job.quality} · {statusLabel(job)}
            {job.status === "done" && job.fileSize ? ` · ${formatBytes(job.fileSize)}` : ""}
          </p>
          {job.status === "error" && (
            <p className="mt-1 text-xs text-red-300">{job.error}</p>
          )}
          {job.status === "cancelled" && (
            <p className="mt-1 text-xs text-slate-500">دانلود توسط شما لغو شد.</p>
          )}
          {running && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${accent} ${
                    job.status === "processing" ? "progress-shimmer" : ""
                  }`}
                  style={{ width: `${Math.max(3, job.progress)}%` }}
                />
              </div>
              <span className="shrink-0 text-xs font-bold text-slate-200 tabular">
                {job.progress}%
              </span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {running && (
            <button
              type="button"
              onClick={() => onCancel(job.jobId)}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20"
            >
              <IconX className="h-3.5 w-3.5" />
              لغو
            </button>
          )}
          {job.status === "done" && job.downloadUrl && (
            <a
              href={job.downloadUrl}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              <IconDownload className="h-3.5 w-3.5" />
              ذخیره فایل
            </a>
          )}
          <button
            type="button"
            onClick={() => onDelete(job.jobId)}
            title="حذف از فهرست"
            aria-label="حذف از فهرست"
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/5 hover:text-red-400"
          >
            <IconTrash className="h-4 w-4" />
          </button>
        </div>
      </div>
    </li>
  );
}

function HistoryRow({ job, onDelete }: { job: PublicJob; onDelete: (jobId: string) => void }) {
  return (
    <li className="group flex items-center gap-3 py-2.5">
      <div className="relative h-9 w-14 shrink-0 overflow-hidden rounded-md bg-slate-800">
        {job.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={job.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-slate-600">
            {job.kind === "video" ? <IconFilm className="h-4 w-4" /> : <IconMusic className="h-4 w-4" />}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-200">{job.title ?? "بدون عنوان"}</p>
        <p className="text-xs text-slate-500">
          {job.quality} · {statusLabel(job)} · {formatRelative(job.createdAt)}
        </p>
      </div>
      {job.status === "done" && job.downloadUrl ? (
        <a
          href={job.downloadUrl}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-300"
        >
          <IconDownload className="h-3.5 w-3.5" />
          دانلود
        </a>
      ) : job.status === "error" ? (
        <span className="text-xs text-red-400">ناموفق</span>
      ) : job.status === "expired" ? (
        <span className="text-xs text-slate-500">حذف شده</span>
      ) : job.status === "cancelled" ? (
        <span className="text-xs text-slate-500">لغو شده</span>
      ) : (
        <span className="text-xs text-amber-300 tabular">{job.progress}%</span>
      )}
      <button
        type="button"
        onClick={() => onDelete(job.jobId)}
        title="حذف از تاریخچه"
        aria-label="حذف از تاریخچه"
        className="rounded-lg p-1.5 text-slate-600 opacity-0 transition hover:bg-white/5 hover:text-red-400 group-hover:opacity-100"
      >
        <IconTrash className="h-4 w-4" />
      </button>
    </li>
  );
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

function InfoSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl bg-slate-900/70 p-5 ring-1 ring-white/10">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="aspect-video w-full rounded-xl bg-slate-800 sm:w-64" />
        <div className="flex-1 space-y-3">
          <div className="h-5 w-3/4 rounded bg-slate-800" />
          <div className="h-4 w-1/2 rounded bg-slate-800" />
          <div className="h-4 w-1/3 rounded bg-slate-800" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-slate-800" />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Icons                                    */
/* -------------------------------------------------------------------------- */

function IconFilm({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </svg>
  );
}

function IconMusic({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function IconDownload({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

function IconSearch({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconLink({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}

function IconClipboard({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

function IconX({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function IconAlert({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function IconUser({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

function IconEye({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconExternal({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

function IconActivity({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function IconClock({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function IconTrash({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function IconRefresh({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
