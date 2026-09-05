"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioQuality, VideoInfo, VideoQuality } from "@/lib/ytdlp";
import type { PublicJob } from "@/lib/jobs";
import { formatBytes, formatDuration, formatRelative, formatViews } from "@/lib/format";

type Tab = "video" | "audio";

const YT_REGEX =
  /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\/.+/i;

export default function Downloader() {
  const [tab, setTab] = useState<Tab>("video");
  const [url, setUrl] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);

  const [activeJobs, setActiveJobs] = useState<PublicJob[]>([]);
  const [history, setHistory] = useState<PublicJob[]>([]);
  const autoDownloaded = useRef<Set<string>>(new Set());

  /* ---------------------------- تاریخچه دانلودها ---------------------------- */
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: PublicJob[] };
      setHistory(data.jobs);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  /* ------------------------------ polling jobها ------------------------------ */
  useEffect(() => {
    const pending = activeJobs.filter((j) => j.status !== "done" && j.status !== "error");
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
  }, [activeJobs, loadHistory]);

  /* ------------------------------ دریافت اطلاعات ------------------------------ */
  const fetchInfo = async (e?: React.FormEvent) => {
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
      if (text) setUrl(text.trim());
    } catch {
      /* ignore */
    }
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
        j.status !== "error",
    );

  return (
    <div className="space-y-8">
      {/* ------------------------------- تب‌ها ------------------------------- */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-900/70 p-1.5 ring-1 ring-white/10">
        <TabButton active={tab === "video"} onClick={() => setTab("video")} icon="🎬">
          دانلود ویدئو
        </TabButton>
        <TabButton active={tab === "audio"} onClick={() => setTab("audio")} icon="🎵">
          دانلود MP3
        </TabButton>
      </div>

      {/* ------------------------------ فرم آدرس ------------------------------ */}
      <form
        onSubmit={fetchInfo}
        className="rounded-2xl bg-slate-900/70 p-4 ring-1 ring-white/10 shadow-2xl shadow-black/40 sm:p-5"
      >
        <label htmlFor="url" className="mb-2 block text-sm text-slate-300">
          {tab === "video"
            ? "آدرس ویدئوی یوتیوب را وارد کنید تا کیفیت‌های موجود لیست شود"
            : "آدرس ویدئوی یوتیوب را وارد کنید تا کیفیت‌های MP3 لیست شود"}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <input
              id="url"
              dir="ltr"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-4 py-3 text-left text-slate-100 placeholder:text-slate-500 outline-none ring-red-500/40 transition focus:border-red-500/60 focus:ring-4"
            />
            <button
              type="button"
              onClick={pasteFromClipboard}
              title="چسباندن از کلیپ‌بورد"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200"
            >
              Paste
            </button>
          </div>
          <button
            type="submit"
            disabled={loadingInfo}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-6 py-3 font-semibold text-white shadow-lg shadow-red-900/40 transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingInfo ? (
              <>
                <Spinner /> در حال بررسی…
              </>
            ) : (
              "بررسی لینک"
            )}
          </button>
        </div>
        {infoError && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {infoError}
          </p>
        )}
      </form>

      {/* ------------------------------ کارت ویدئو ------------------------------ */}
      {loadingInfo && <InfoSkeleton />}
      {info && !loadingInfo && (
        <section className="overflow-hidden rounded-2xl bg-slate-900/70 ring-1 ring-white/10 shadow-2xl shadow-black/40">
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
            <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-slate-800 sm:w-64">
              {info.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={info.thumbnail}
                  alt={info.title}
                  className="h-full w-full object-cover"
                />
              )}
              <span className="absolute bottom-2 left-2 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white tabular">
                {formatDuration(info.duration)}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-lg font-bold leading-relaxed text-white">
                {info.title}
              </h2>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
                {info.uploader && <span>📺 {info.uploader}</span>}
                {info.viewCount != null && <span>👁 {formatViews(info.viewCount)} بازدید</span>}
                {info.sourceAudioBitrate ? (
                  <span>🎧 صدای اصلی ~{info.sourceAudioBitrate} kbps</span>
                ) : null}
              </div>
              <a
                href={info.webpageUrl}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                className="mt-2 block truncate text-left text-xs text-sky-400 hover:underline"
              >
                {info.webpageUrl}
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
                  <p className="col-span-full text-sm text-slate-400">
                    کیفیت ویدئویی برای این لینک یافت نشد.
                  </p>
                )}
                {info.videoQualities.map((q) => (
                  <VideoQualityButton
                    key={q.height + (q.fps ?? 0)}
                    q={q}
                    busy={isJobRunning("video", `${q.height}p`)}
                    onClick={() => startJob("video", q.height)}
                  />
                ))}
              </QualityGrid>
            ) : (
              <QualityGrid>
                {info.audioQualities.map((q) => (
                  <AudioQualityButton
                    key={q.bitrate}
                    q={q}
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
        <section className="rounded-2xl bg-slate-900/70 p-4 ring-1 ring-white/10 sm:p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-300">دانلودهای این نشست</h3>
          <ul className="space-y-3">
            {activeJobs.map((j) => (
              <JobRow key={j.jobId} job={j} />
            ))}
          </ul>
        </section>
      )}

      {/* --------------------------------- تاریخچه --------------------------------- */}
      <section className="rounded-2xl bg-slate-900/50 p-4 ring-1 ring-white/10 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300">تاریخچه دانلودها</h3>
          <button
            onClick={() => void loadHistory()}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            بروزرسانی
          </button>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">هنوز دانلودی ثبت نشده است.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {history.map((j) => (
              <HistoryRow key={j.jobId} job={j} />
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
  icon: string;
  children: React.ReactNode;
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
      <span>{icon}</span>
      {children}
    </button>
  );
}

function QualityGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

function VideoQualityButton({
  q,
  busy,
  onClick,
}: {
  q: VideoQuality;
  busy: boolean;
  onClick: () => void;
}) {
  const tier =
    q.height >= 2160 ? "4K" : q.height >= 1440 ? "2K" : q.height >= 1080 ? "Full HD" : q.height >= 720 ? "HD" : "SD";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="group relative flex flex-col items-start gap-1 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-right transition hover:border-red-500/60 hover:bg-red-500/5 disabled:cursor-wait disabled:opacity-60"
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-lg font-bold text-white tabular">{q.label}</span>
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
          {tier}
        </span>
      </div>
      <span className="text-xs text-slate-400 tabular">
        MP4 · {formatBytes(q.filesize)}
        {q.fps ? ` · ${q.fps}fps` : ""}
      </span>
      <span className="mt-1 text-xs font-semibold text-red-400 group-hover:text-red-300">
        {busy ? "در حال دانلود…" : "⬇ دانلود"}
      </span>
    </button>
  );
}

function AudioQualityButton({
  q,
  busy,
  onClick,
}: {
  q: AudioQuality;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="group relative flex flex-col items-start gap-1 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-right transition hover:border-emerald-500/60 hover:bg-emerald-500/5 disabled:cursor-wait disabled:opacity-60"
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-lg font-bold text-white tabular">{q.label}</span>
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
          MP3
        </span>
      </div>
      <span className="text-xs text-slate-400 tabular">
        {q.tag} · ~{formatBytes(q.filesize)}
      </span>
      <span className="mt-1 text-xs font-semibold text-emerald-400 group-hover:text-emerald-300">
        {busy ? "در حال تبدیل…" : "⬇ دانلود"}
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
    case "expired":
      return "منقضی شده";
    default:
      return "در صف";
  }
}

function JobRow({ job }: { job: PublicJob }) {
  const running = job.status === "downloading" || job.status === "processing";
  return (
    <li className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
      <div className="flex items-start gap-3">
        {job.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={job.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded-md object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{job.title}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {job.kind === "video" ? "🎬 MP4" : "🎵 MP3"} · {job.quality} · {statusLabel(job)}
            {job.status === "done" && job.fileSize ? ` · ${formatBytes(job.fileSize)}` : ""}
          </p>
          {job.status === "error" && (
            <p className="mt-1 text-xs text-red-300">{job.error}</p>
          )}
          {running && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  job.kind === "video" ? "bg-red-500" : "bg-emerald-500"
                } ${job.status === "processing" ? "progress-shimmer" : ""}`}
                style={{ width: `${Math.max(3, job.progress)}%` }}
              />
            </div>
          )}
        </div>
        <div className="shrink-0 text-left">
          {running && (
            <span className="text-sm font-bold text-slate-200 tabular">{job.progress}%</span>
          )}
          {job.status === "done" && job.downloadUrl && (
            <a
              href={job.downloadUrl}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              ⬇ ذخیره فایل
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function HistoryRow({ job }: { job: PublicJob }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="text-lg">{job.kind === "video" ? "🎬" : "🎵"}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-200">{job.title ?? "بدون عنوان"}</p>
        <p className="text-xs text-slate-500">
          {job.quality} · {statusLabel(job)} · {formatRelative(job.createdAt)}
        </p>
      </div>
      {job.status === "done" && job.downloadUrl ? (
        <a
          href={job.downloadUrl}
          className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300"
        >
          دانلود
        </a>
      ) : job.status === "error" ? (
        <span className="text-xs text-red-400">ناموفق</span>
      ) : job.status === "expired" ? (
        <span className="text-xs text-slate-500">حذف شده</span>
      ) : (
        <span className="text-xs text-amber-300 tabular">{job.progress}%</span>
      )}
    </li>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function InfoSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl bg-slate-900/70 p-5 ring-1 ring-white/10">
      <div className="flex gap-4">
        <div className="aspect-video w-64 rounded-xl bg-slate-800" />
        <div className="flex-1 space-y-3">
          <div className="h-5 w-3/4 rounded bg-slate-800" />
          <div className="h-4 w-1/2 rounded bg-slate-800" />
          <div className="h-4 w-1/3 rounded bg-slate-800" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-slate-800" />
        ))}
      </div>
    </div>
  );
}
