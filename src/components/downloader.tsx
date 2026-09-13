"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import type { AudioQuality, VideoInfo, VideoQuality } from "@/lib/ytdlp";
import type { PublicJob } from "@/lib/jobs";
import { faNum, formatBytes, formatDuration, formatRelative, formatViews } from "@/lib/format";
import { demoActiveJobs, demoHistory, demoVideoInfo } from "@/lib/demo";
import {
  IconActivity,
  IconAlert,
  IconCheck,
  IconClipboard,
  IconClock,
  IconDatabase,
  IconDownload,
  IconExternal,
  IconEye,
  IconFilm,
  IconLink,
  IconMusic,
  IconQueue,
  IconRefresh,
  IconSearch,
  IconServer,
  IconShield,
  IconSparkles,
  IconSpinner,
  IconTrash,
  IconUser,
  IconX,
} from "@/components/icons";
import { Card, Chip, PercentText, ProgressBar, SectionHeader, Toaster, useToasts } from "@/components/ui";

type Tab = "video" | "audio";
type HistoryFilter = "all" | "video" | "audio";

const YT_REGEX =
  /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\/.+/i;

interface HealthState {
  ok: boolean;
  demo: boolean;
  db: "up" | "down" | "disabled";
  tools: {
    ytdlp: boolean;
    ytdlpVersion: string | null;
    ytdlpSource: string | null;
    ffmpeg: boolean;
    ffmpegVersion: string | null;
  };
  queue: { active: number; queued: number; max: number };
}

function isActive(job: PublicJob): boolean {
  return job.status === "pending" || job.status === "downloading" || job.status === "processing";
}

export default function Downloader({ demo = false }: { demo?: boolean }) {
  const [tab, setTab] = useState<Tab>("video");
  const [url, setUrl] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [demoActive, setDemoActive] = useState(demo);

  const [activeJobs, setActiveJobs] = useState<PublicJob[]>(demo ? demoActiveJobs : []);
  const [history, setHistory] = useState<PublicJob[]>(demo ? demoHistory : []);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [health, setHealth] = useState<HealthState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { toasts, push, dismiss } = useToasts();
  const autoDownloaded = useRef<Set<string>>(new Set());

  /* ----------------------------- وضعیت سامانه ----------------------------- */
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json()) as HealthState;
        if (!cancelled) {
          setHealth(data);
          if (data.demo) setDemoActive(true);
        }
      } catch {
        /* وضعیت سامانه اختیاری است */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo]);

  /* ---------------------------- تاریخچه دانلودها ---------------------------- */
  const loadHistory = useCallback(async () => {
    if (demo) return;
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: PublicJob[] };
      setHistory(data.jobs);
    } catch {
      /* بی‌صدا؛ دکمه‌ی بروزرسانی برای تلاش دوباره هست */
    }
  }, [demo]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadHistory();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHistory]);

  /* ------------------------------ polling jobها ----------------------------- */
  // کلید پایدار: تا وقتی مجموعه‌ی jobهای فعال تغییر نکرده، اینتروال بازسازی نمی‌شود.
  const activeKey = useMemo(
    () =>
      activeJobs
        .filter(isActive)
        .map((j) => j.jobId)
        .join(","),
    [activeJobs],
  );

  useEffect(() => {
    if (demo || !activeKey) return;
    const ids = activeKey.split(",");
    let stopped = false;
    let finishedAny = false;

    const tick = async () => {
      const updates = await Promise.all(
        ids.map(async (jobId) => {
          try {
            const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
            if (!res.ok) return null;
            const data = (await res.json()) as { job: PublicJob };
            return data.job;
          } catch {
            return null;
          }
        }),
      );
      if (stopped) return;

      setActiveJobs((prev) =>
        prev.map((job) => updates.find((u) => u && u.jobId === job.jobId) ?? job),
      );

      for (const update of updates) {
        if (!update) continue;
        if (update.status === "done" && update.downloadUrl && !autoDownloaded.current.has(update.jobId)) {
          autoDownloaded.current.add(update.jobId);
          triggerBrowserDownload(update.downloadUrl);
          push(
            "success",
            "فایل آماده شد",
            `${update.title ?? "دانلود"} — ${formatBytes(update.fileSize)}`,
          );
          finishedAny = true;
        }
        if (update.status === "error") {
          push("error", "دانلود ناموفق بود", update.error ?? undefined);
          finishedAny = true;
        }
      }

      if (finishedAny) {
        finishedAny = false;
        void loadHistory();
      }
    };

    const timer = window.setInterval(tick, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeKey, demo, loadHistory, push]);

  /* ------------------------------ دریافت اطلاعات ------------------------------ */
  const fetchInfo = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = url.trim();
    if (!YT_REGEX.test(trimmed)) {
      setInfoError("لطفاً یک آدرس معتبر یوتیوب وارد کنید (مثلاً https://youtu.be/…)");
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
      const data = (await res.json()) as { info?: VideoInfo; error?: string; demo?: boolean };
      if (!res.ok || !data.info) {
        setInfoError(data.error ?? "خطایی رخ داد");
        push("error", "دریافت اطلاعات ویدئو ناموفق بود", data.error ?? undefined);
        return;
      }
      if (data.demo) setDemoActive(true);
      setInfo(data.info);
    } catch {
      setInfoError("ارتباط با سرور برقرار نشد");
      push("error", "ارتباط با سرور برقرار نشد");
    } finally {
      setLoadingInfo(false);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        push("info", "کلیپ‌بورد خالی است");
        return;
      }
      setUrl(text.trim());
      setInfoError(null);
      setInfo(null);
    } catch {
      push("error", "دسترسی به کلیپ‌بورد ممکن نشد", "می‌توانید آدرس را دستی بچسبانید.");
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
      const data = (await res.json()) as { job?: PublicJob; error?: string; reused?: boolean };
      if (!res.ok || !data.job) {
        push("error", "شروع دانلود ناموفق بود", data.error ?? undefined);
        return;
      }
      const job = data.job;
      setActiveJobs((prev) => [job, ...prev.filter((j) => j.jobId !== job.jobId)]);
      push(
        job.status === "pending" ? "info" : "success",
        data.reused
          ? "این دانلود از قبل در جریان است"
          : job.status === "pending"
            ? "دانلود در صف قرار گرفت"
            : "دانلود آغاز شد",
        `${kind === "video" ? "ویدئو" : "MP3"} · ${job.quality}`,
      );
      void loadHistory();
    } catch {
      push("error", "ارتباط با سرور برقرار نشد");
    }
  };

  const isJobRunning = (kind: Tab, quality: string) =>
    Boolean(info) &&
    activeJobs.some(
      (j) =>
        isActive(j) &&
        j.kind === kind &&
        j.quality === quality &&
        j.videoId === info?.id,
    );

  /* ------------------------------ لغو و حذف job ------------------------------ */
  const cancelJob = async (jobId: string) => {
    setActiveJobs((prev) =>
      prev.map((j) =>
        j.jobId === jobId ? { ...j, status: "cancelled" as const, progress: 0, speed: null, eta: null } : j,
      ),
    );
    if (demo) {
      push("info", "لغو شد", "در حالت پیش‌نمایش فقط ظاهر دکمه‌ها فعال است.");
      return;
    }
    try {
      const res = await fetch(`/api/jobs/${jobId}?cancel=1`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        push("error", "لغو دانلود ناموفق بود", data.error);
      } else {
        push("info", "دانلود لغو شد");
      }
    } catch {
      push("error", "ارتباط با سرور برقرار نشد");
    }
    void loadHistory();
  };

  const deleteJob = async (jobId: string) => {
    setActiveJobs((prev) => prev.filter((j) => j.jobId !== jobId));
    setHistory((prev) => prev.filter((j) => j.jobId !== jobId));
    setConfirmDelete(null);
    if (demo) return;
    try {
      await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    } catch {
      push("error", "حذف دانلود ناموفق بود");
    }
    void loadHistory();
  };

  const runningCount = activeJobs.filter(isActive).length;
  const filteredHistory = history.filter((j) => historyFilter === "all" || j.kind === historyFilter);

  return (
    <div className="space-y-6">
      <Toaster toasts={toasts} onDismiss={dismiss} />

      {demoActive && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100 sm:flex-row sm:items-center">
          <span className="flex items-start gap-2">
            <IconSparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong className="font-semibold">حالت نمایشی فعال است. </strong>
              اطلاعات ویدئو نمونه است و فایل نهایی از یک کلیپ محلی ساخته می‌شود؛ فرایند دانلود،
              پیشرفت و تبدیل کاملاً واقعی اجرا می‌شود.
            </span>
          </span>
          {demo ? (
            <Link
              href="/"
              className="shrink-0 rounded-lg border border-sky-400/40 px-3 py-1.5 text-xs font-semibold transition hover:bg-sky-500/20"
            >
              بازگشت به اپلیکیشن
            </Link>
          ) : null}
        </div>
      )}

      {/* ------------------------------- تب‌ها ------------------------------- */}
      <div
        role="tablist"
        aria-label="نوع دانلود"
        className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/10 bg-slate-900/60 p-1.5 backdrop-blur-xl"
      >
        <TabButton
          id="tab-video"
          active={tab === "video"}
          onClick={() => setTab("video")}
          icon={<IconFilm />}
        >
          دانلود ویدئو
        </TabButton>
        <TabButton
          id="tab-audio"
          active={tab === "audio"}
          onClick={() => setTab("audio")}
          icon={<IconMusic />}
        >
          دانلود MP3
        </TabButton>
      </div>

      {/* ------------------------------ فرم آدرس ------------------------------ */}
      <div
        role="tabpanel"
        id="download-panel"
        aria-labelledby={tab === "video" ? "tab-video" : "tab-audio"}
        className="space-y-6"
      >
      <Card className="p-4 sm:p-5">
        <form onSubmit={fetchInfo}>
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
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(infoError)}
                aria-describedby={infoError ? "url-error" : undefined}
                className="w-full rounded-xl border border-white/10 bg-slate-950/80 py-3 pl-10 pr-9 text-left text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-red-500/60 focus:ring-4 focus:ring-red-500/20"
              />
              {url && (
                <button
                  type="button"
                  onClick={clearUrl}
                  title="پاک کردن"
                  aria-label="پاک کردن آدرس"
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
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <IconClipboard className="h-4 w-4" />
                <span className="hidden md:inline">چسباندن</span>
              </button>
              <button
                type="submit"
                disabled={loadingInfo}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-red-600 to-rose-500 px-6 py-3 font-semibold text-white shadow-lg shadow-red-900/40 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingInfo ? (
                  <>
                    <IconSpinner /> در حال بررسی…
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
            <p
              id="url-error"
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
            >
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{infoError}</span>
              <button
                type="button"
                onClick={() => void fetchInfo()}
                className="shrink-0 rounded-lg border border-red-400/40 px-2 py-0.5 text-xs font-semibold transition hover:bg-red-500/20"
              >
                تلاش دوباره
              </button>
            </p>
          )}
        </form>
      </Card>

      {/* ------------------------------ کارت ویدئو ------------------------------ */}
      {loadingInfo && <InfoSkeleton />}
      {info && !loadingInfo && (
        <Card className="animate-fade-up overflow-hidden">
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
            <div className="group relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-slate-800 sm:w-64">
              {info.thumbnail ? (
                <Thumbnail src={info.thumbnail} alt={info.title} />
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
                  <Chip>
                    <IconUser className="h-3.5 w-3.5" />
                    {info.uploader}
                  </Chip>
                )}
                {info.viewCount != null && (
                  <Chip>
                    <IconEye className="h-3.5 w-3.5" />
                    {faNum(formatViews(info.viewCount))} بازدید
                  </Chip>
                )}
                {info.sourceAudioBitrate ? (
                  <Chip>
                    <IconMusic className="h-3.5 w-3.5" />
                    صدای اصلی ~{info.sourceAudioBitrate} kbps
                  </Chip>
                ) : null}
              </div>
              <a
                href={info.webpageUrl}
                target="_blank"
                rel="noreferrer noopener"
                dir="ltr"
                className="mt-3 inline-flex max-w-full items-center gap-1 truncate text-left text-xs text-sky-400 transition hover:text-sky-300 hover:underline"
              >
                <IconExternal className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{info.webpageUrl}</span>
              </a>
            </div>
          </div>

          <div className="border-t border-white/10 p-4 sm:p-5">
            <SectionHeader
              icon={tab === "video" ? <IconFilm /> : <IconMusic />}
              title={tab === "video" ? "کیفیت ویدئو را انتخاب کنید (MP4)" : "کیفیت فایل MP3 را انتخاب کنید"}
              badge={
                <Chip tone={tab === "video" ? "red" : "emerald"}>
                  {faNum(
                    (tab === "video" ? info.videoQualities.length : info.audioQualities.length).toString(),
                  )}{" "}
                  گزینه
                </Chip>
              }
            />

            {tab === "video" ? (
              <QualityGrid>
                {info.videoQualities.length === 0 && (
                  <p className="col-span-full rounded-xl border border-white/5 bg-slate-950/40 px-4 py-6 text-center text-sm text-slate-400">
                    کیفیت ویدئویی برای این لینک یافت نشد.
                  </p>
                )}
                {info.videoQualities.map((q, i) => (
                  <VideoQualityButton
                    key={q.height}
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

            <p className="mt-4 flex items-start gap-2 rounded-xl border border-white/5 bg-slate-950/40 px-3 py-2 text-[11px] leading-5 text-slate-400">
              <IconShield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
              فایل‌ها موقتاً روی سرور نگه داشته می‌شوند و پس از پایان مهلت (پیش‌فرض ۲ ساعت)
              به‌صورت خودکار پاک می‌شوند. تنها محتوایی را دانلود کنید که اجازه‌ی آن را دارید.
            </p>
          </div>
        </Card>
      )}
      </div>

      {/* ------------------------------ دانلودهای فعال ------------------------------ */}
      {activeJobs.length > 0 && (
        <Card className="animate-fade-up p-4 sm:p-5">
          <SectionHeader
            icon={<IconActivity className="h-4 w-4 text-red-400" />}
            title="دانلودهای این نشست"
            badge={
              <Chip tone={runningCount > 0 ? "red" : "slate"}>
                {runningCount > 0 ? (
                  <>
                    <IconSpinner className="h-3 w-3" />
                    {faNum(runningCount.toString())} فعال
                  </>
                ) : (
                  <>
                    <IconCheck className="h-3 w-3" />
                    پایان‌یافته
                  </>
                )}
              </Chip>
            }
          />
          <ul className="space-y-3" aria-live="polite">
            {activeJobs.map((j) => (
              <JobRow
                key={j.jobId}
                job={j}
                confirming={confirmDelete === j.jobId}
                onAskDelete={() => setConfirmDelete(confirmDelete === j.jobId ? null : j.jobId)}
                onCancel={cancelJob}
                onDelete={deleteJob}
              />
            ))}
          </ul>
        </Card>
      )}

      {/* --------------------------------- تاریخچه --------------------------------- */}
      <Card className="bg-slate-900/40 p-4 sm:p-5">
        <SectionHeader
          icon={<IconClock className="h-4 w-4" />}
          title="تاریخچه دانلودها"
          action={
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-1 rounded-xl border border-white/10 bg-slate-950/60 p-0.5 sm:flex">
                {(
                  [
                    ["all", "همه"],
                    ["video", "ویدئو"],
                    ["audio", "MP3"],
                  ] as [HistoryFilter, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setHistoryFilter(value)}
                    aria-pressed={historyFilter === value}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                      historyFilter === value
                        ? "bg-white/10 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void loadHistory()}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
              >
                <IconRefresh className="h-3.5 w-3.5" />
                بروزرسانی
              </button>
            </div>
          }
        />
        {filteredHistory.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
            <IconDownload className="mx-auto mb-2 h-8 w-8 text-slate-600" />
            <p className="text-sm text-slate-500">
              {history.length === 0 ? "هنوز دانلودی ثبت نشده است." : "موردی با این فیلتر پیدا نشد."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {filteredHistory.map((j) => (
              <HistoryRow
                key={j.jobId}
                job={j}
                confirming={confirmDelete === j.jobId}
                onAskDelete={() => setConfirmDelete(confirmDelete === j.jobId ? null : j.jobId)}
                onDelete={deleteJob}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* ------------------------------ وضعیت سامانه ------------------------------ */}
      {health && <SystemStatus health={health} />}
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
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** تصویر بندانگشتی با جایگزین گرافیکی در صورت خطای بارگذاری */
function Thumbnail({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-slate-600">
        <IconFilm className="h-10 w-10" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
    />
  );
}

function TabButton({
  id,
  active,
  onClick,
  icon,
  children,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls="download-panel"
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 ${
        active
          ? "bg-gradient-to-l from-red-600 to-rose-500 text-white shadow-lg shadow-red-900/40"
          : "text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function QualityGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

function RecommendedBadge({ tone }: { tone: "red" | "emerald" }) {
  const tones = {
    red: "from-red-600 to-rose-500 text-white",
    emerald: "from-emerald-500 to-teal-400 text-emerald-950",
  };
  return (
    <span
      className={`absolute -top-2.5 left-3 rounded-full bg-gradient-to-l px-2 py-0.5 text-[10px] font-bold shadow-lg shadow-black/40 ${tones[tone]}`}
    >
      پیشنهادی
    </span>
  );
}

function QualityCard({
  tone,
  recommended,
  busy,
  badge,
  title,
  subtitle,
  actionLabel,
  busyLabel,
  onClick,
}: {
  tone: "red" | "emerald";
  recommended: boolean;
  busy: boolean;
  badge: string;
  title: string;
  subtitle: ReactNode;
  actionLabel: string;
  busyLabel: string;
  onClick: () => void;
}) {
  const tones = {
    red: {
      recommended: "border-red-500/50 bg-red-500/10 hover:border-red-400",
      normal: "border-white/10 bg-slate-950/50 hover:border-red-500/60 hover:bg-red-500/5",
      text: "text-red-400 group-hover:text-red-300",
    },
    emerald: {
      recommended: "border-emerald-500/50 bg-emerald-500/10 hover:border-emerald-400",
      normal: "border-white/10 bg-slate-950/50 hover:border-emerald-500/60 hover:bg-emerald-500/5",
      text: "text-emerald-400 group-hover:text-emerald-300",
    },
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      className={`group relative flex flex-col items-start gap-1.5 rounded-xl border p-3 text-right transition duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0 ${
        recommended ? tones.recommended : tones.normal
      }`}
    >
      {recommended && !busy && <RecommendedBadge tone={tone} />}
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-lg font-bold text-white tabular">{title}</span>
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
          {badge}
        </span>
      </div>
      <span className="text-xs text-slate-400 tabular">{subtitle}</span>
      <span className={`mt-0.5 inline-flex items-center gap-1 text-xs font-semibold ${tones.text}`}>
        {busy ? (
          <>
            <IconSpinner className="h-3.5 w-3.5" /> {busyLabel}
          </>
        ) : (
          <>
            <IconDownload className="h-3.5 w-3.5" />
            {actionLabel}
          </>
        )}
      </span>
    </button>
  );
}

function tierOf(height: number): string {
  if (height >= 2160) return "4K";
  if (height >= 1440) return "2K";
  if (height >= 1080) return "Full HD";
  if (height >= 720) return "HD";
  return "SD";
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
  return (
    <QualityCard
      tone="red"
      recommended={recommended}
      busy={busy}
      badge={tierOf(q.height)}
      title={q.label}
      subtitle={
        <>
          MP4 · {formatBytes(q.filesize)}
          {q.fps ? ` · ${q.fps}fps` : ""}
          {!q.hasAudio ? " · + صدا" : ""}
        </>
      }
      actionLabel={recommended ? "بهترین کیفیت" : "دانلود"}
      busyLabel="در حال دانلود…"
      onClick={onClick}
    />
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
    <QualityCard
      tone="emerald"
      recommended={recommended}
      busy={busy}
      badge="MP3"
      title={q.label}
      subtitle={
        <>
          {q.tag} · ~{formatBytes(q.filesize)}
        </>
      }
      actionLabel={recommended ? "بالاترین کیفیت" : "دانلود"}
      busyLabel="در حال تبدیل…"
      onClick={onClick}
    />
  );
}

function statusMeta(job: PublicJob): { label: string; tone: "slate" | "red" | "emerald" | "amber" | "sky" } {
  switch (job.status) {
    case "pending":
      return { label: job.queuePosition ? `در صف (${faNum(job.queuePosition)})` : "در صف", tone: "amber" };
    case "downloading":
      return { label: "در حال دانلود از یوتیوب", tone: "red" };
    case "processing":
      return {
        label: job.kind === "audio" ? "در حال تبدیل به MP3" : "در حال ادغام ویدئو و صدا",
        tone: "sky",
      };
    case "done":
      return { label: "آماده دانلود", tone: "emerald" };
    case "error":
      return { label: "خطا", tone: "red" };
    case "cancelled":
      return { label: "لغو شده", tone: "slate" };
    case "expired":
      return { label: "منقضی شده", tone: "slate" };
    default:
      return { label: "نامشخص", tone: "slate" };
  }
}

function DeleteButton({
  confirming,
  onAsk,
  onDelete,
  label,
}: {
  confirming: boolean;
  onAsk: () => void;
  onDelete: () => void;
  label: string;
}) {
  return confirming ? (
    <button
      type="button"
      onClick={onDelete}
      autoFocus
      className="rounded-lg border border-red-500/40 bg-red-500/15 px-2.5 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-500/25"
    >
      <span className="inline-flex items-center gap-1">
        <IconTrash className="h-3.5 w-3.5" />
        تأیید حذف
      </span>
    </button>
  ) : (
    <button
      type="button"
      onClick={onAsk}
      title={label}
      aria-label={label}
      className="rounded-lg p-2 text-slate-500 transition hover:bg-white/5 hover:text-red-300"
    >
      <IconTrash className="h-4 w-4" />
    </button>
  );
}

function JobRow({
  job,
  confirming,
  onAskDelete,
  onCancel,
  onDelete,
}: {
  job: PublicJob;
  confirming: boolean;
  onAskDelete: () => void;
  onCancel: (jobId: string) => void;
  onDelete: (jobId: string) => void;
}) {
  const status = statusMeta(job);
  const running = job.status === "downloading" || job.status === "processing";
  const progressText =
    job.status === "pending"
      ? "در انتظار نوبت"
      : running
        ? job.status === "processing"
          ? "پردازش نهایی…"
          : `${faNum(job.speed ?? "—")} · باقی‌مانده ${faNum(job.eta ?? "—")}`
        : null;

  return (
    <li className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
      <div className="flex items-start gap-3">
        <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-800">
          {job.thumbnail ? (
            <Thumbnail src={job.thumbnail} alt="" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-slate-600">
              {job.kind === "video" ? <IconFilm className="h-4 w-4" /> : <IconMusic className="h-4 w-4" />}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white" title={job.title ?? undefined}>
            {job.title ?? "بدون عنوان"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Chip tone={job.kind === "video" ? "red" : "emerald"}>
              {job.kind === "video" ? "MP4" : "MP3"} · {job.quality}
            </Chip>
            <Chip tone={status.tone}>{status.label}</Chip>
            {job.status === "done" && job.fileSize ? (
              <Chip>{formatBytes(job.fileSize)}</Chip>
            ) : null}
          </div>

          {job.status === "error" && job.error ? (
            <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-2 py-1 text-xs leading-5 text-red-200">
              {job.error}
            </p>
          ) : null}
          {job.status === "cancelled" ? (
            <p className="mt-1 text-xs text-slate-500">دانلود توسط شما لغو شد.</p>
          ) : null}

          {(running || job.status === "pending") && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1">
                <ProgressBar
                  value={job.progress}
                  tone={job.kind === "video" ? "red" : "emerald"}
                  animated={job.status === "processing"}
                  label={`پیشرفت دانلود ${job.title ?? ""}`}
                />
              </div>
              <span className="shrink-0 text-xs font-bold text-slate-200 tabular">
                {job.status === "pending" ? <IconQueue className="h-3.5 w-3.5" /> : <PercentText value={job.progress} />}
              </span>
            </div>
          )}
          {progressText ? (
            <p className="mt-1 text-[11px] text-slate-400 tabular">{progressText}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
          {running || job.status === "pending" ? (
            <button
              type="button"
              onClick={() => onCancel(job.jobId)}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20"
            >
              <IconX className="h-3.5 w-3.5" />
              لغو
            </button>
          ) : null}
          {job.status === "done" && job.downloadUrl ? (
            <a
              href={job.downloadUrl}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              <IconDownload className="h-3.5 w-3.5" />
              ذخیره فایل
            </a>
          ) : null}
          <DeleteButton
            confirming={confirming}
            onAsk={onAskDelete}
            onDelete={() => onDelete(job.jobId)}
            label="حذف از فهرست"
          />
        </div>
      </div>
    </li>
  );
}

function HistoryRow({
  job,
  confirming,
  onAskDelete,
  onDelete,
}: {
  job: PublicJob;
  confirming: boolean;
  onAskDelete: () => void;
  onDelete: (jobId: string) => void;
}) {
  const status = statusMeta(job);
  return (
    <li className="group flex items-center gap-3 py-2.5">
      <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-800">
        {job.thumbnail ? (
          <Thumbnail src={job.thumbnail} alt="" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-slate-600">
            {job.kind === "video" ? <IconFilm className="h-4 w-4" /> : <IconMusic className="h-4 w-4" />}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-200" title={job.title ?? undefined}>
          {job.title ?? "بدون عنوان"}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span className="tabular">
            {job.kind === "video" ? "MP4" : "MP3"} · {job.quality}
          </span>
          <span aria-hidden>·</span>
          <span suppressHydrationWarning>{formatRelative(job.createdAt)}</span>
          {job.status === "done" && job.fileSize ? (
            <>
              <span aria-hidden>·</span>
              <span className="tabular">{formatBytes(job.fileSize)}</span>
            </>
          ) : null}
        </p>
      </div>

      <Chip tone={status.tone} className="hidden sm:inline-flex">
        {status.label}
      </Chip>

      {job.status === "done" && job.downloadUrl ? (
        <a
          href={job.downloadUrl}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-300"
        >
          <IconDownload className="h-3.5 w-3.5" />
          دانلود
        </a>
      ) : null}

      <DeleteButton
        confirming={confirming}
        onAsk={onAskDelete}
        onDelete={() => onDelete(job.jobId)}
        label="حذف از تاریخچه"
      />
    </li>
  );
}

function SystemStatus({ health }: { health: HealthState }) {
  const items: { icon: ReactNode; label: string; ok: boolean; hint: string }[] = [
    {
      icon: <IconServer className="h-3.5 w-3.5" />,
      label: health.tools.ytdlp ? `yt-dlp ${health.tools.ytdlpVersion ?? ""}`.trim() : "yt-dlp نصب نیست",
      ok: health.tools.ytdlp,
      hint: health.tools.ytdlp
        ? `منبع: ${health.tools.ytdlpSource ?? "نامشخص"}`
        : "در اولین دانلود به‌صورت خودکار نصب می‌شود",
    },
    {
      icon: <IconFilm className="h-3.5 w-3.5" />,
      label: health.tools.ffmpeg
        ? `ffmpeg ${health.tools.ffmpegVersion ? health.tools.ffmpegVersion.split("-")[0] : ""}`.trim()
        : "ffmpeg نصب نیست",
      ok: health.tools.ffmpeg,
      hint: health.tools.ffmpeg ? "برای ادغام و ساخت MP3" : "ادغام ویدئو/صدا و ساخت MP3 نیاز به ffmpeg دارد",
    },
    {
      icon: <IconDatabase className="h-3.5 w-3.5" />,
      label:
        health.db === "up"
          ? "دیتابیس متصل"
          : health.db === "disabled"
            ? "بدون دیتابیس"
            : "دیتابیس قطع است",
      ok: health.db === "up",
      hint:
        health.db === "disabled"
          ? "تاریخچه ذخیره نمی‌شود؛ با تنظیم DATABASE_URL فعال کنید"
          : health.db === "up"
            ? "تاریخچه دانلودها ذخیره می‌شود"
            : "اتصال به PostgreSQL برقرار نشد",
    },
    {
      icon: <IconQueue className="h-3.5 w-3.5" />,
      label: `صف: ${faNum(health.queue.active)}/${faNum(health.queue.max)}${
        health.queue.queued ? ` (+${faNum(health.queue.queued)})` : ""
      }`,
      ok: true,
      hint: "تعداد دانلودهای هم‌زمان و در انتظار",
    },
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-400">
      {items.map((item) => (
        <span
          key={item.label}
          title={item.hint}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
            item.ok
              ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-200/90"
              : "border-amber-500/20 bg-amber-500/5 text-amber-200/90"
          }`}
        >
          <span className={item.ok ? "text-emerald-400" : "text-amber-400"}>{item.icon}</span>
          {item.label}
        </span>
      ))}
    </div>
  );
}

function InfoSkeleton() {
  return (
    <Card className="p-5">
      <div className="flex animate-pulse flex-col gap-4 sm:flex-row">
        <div className="aspect-video w-full rounded-xl bg-slate-800/80 sm:w-64" />
        <div className="flex-1 space-y-3">
          <div className="h-5 w-3/4 rounded bg-slate-800/80" />
          <div className="h-4 w-1/2 rounded bg-slate-800/80" />
          <div className="h-4 w-1/3 rounded bg-slate-800/80" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-800/60" />
        ))}
      </div>
    </Card>
  );
}
