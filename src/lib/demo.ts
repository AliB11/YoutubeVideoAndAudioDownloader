import type { AudioQuality, VideoInfo, VideoQuality } from "@/lib/ytdlp";
import type { PublicJob } from "@/lib/jobs";

/**
 * داده‌های نمایشی برای «حالت پیش‌نمایش» — فقط برای دیدن طراحی رابط کاربری،
 * بدون نیاز به یوتیوب/دیتابیس/yt-dlp.
 */

/** ساخت تصویر بندانگشتی SVG به‌صورت data-URI (کاملاً آفلاین و بدون وابستگی به شبکه) */
function thumb(label: string, from: string, to: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="320" height="180" fill="url(#g)"/>` +
    `<circle cx="160" cy="88" r="26" fill="rgba(0,0,0,0.45)"/>` +
    `<path d="M150 74 L178 88 L150 102 Z" fill="#fff"/>` +
    `<text x="16" y="166" font-family="sans-serif" font-size="13" fill="rgba(255,255,255,0.92)">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const T_MAIN = thumb("پیش‌نمایش ویدئو", "#1e1b4b", "#7f1d1d");
const T_VIDEO = thumb("ویدئو", "#0f172a", "#be123c");
const T_AUDIO = thumb("صدا", "#042f2e", "#059669");
const T_VIDEO2 = thumb("ویدئو ۷۲۰", "#172554", "#7c3aed");
const T_AUDIO2 = thumb("صدا ۱۹۲", "#0c4a6e", "#0284c7");
const T_ERR = thumb("خطا", "#3f1d1d", "#7f1d1d");

const videoQualities: VideoQuality[] = [
  { height: 2160, label: "2160p", fps: 60, ext: "mp4", vcodec: "avc1", filesize: 1_980_000_000, hasAudio: false },
  { height: 1440, label: "1440p", fps: 60, ext: "mp4", vcodec: "avc1", filesize: 1_120_000_000, hasAudio: false },
  { height: 1080, label: "1080p", fps: 60, ext: "mp4", vcodec: "avc1", filesize: 640_000_000, hasAudio: false },
  { height: 720, label: "720p", fps: null, ext: "mp4", vcodec: "avc1", filesize: 330_000_000, hasAudio: true },
  { height: 480, label: "480p", fps: null, ext: "mp4", vcodec: "avc1", filesize: 170_000_000, hasAudio: true },
  { height: 360, label: "360p", fps: null, ext: "mp4", vcodec: "avc1", filesize: 95_000_000, hasAudio: true },
];

const audioQualities: AudioQuality[] = [
  { bitrate: 320, label: "320 kbps", filesize: 28_000_000, tag: "بالاترین کیفیت" },
  { bitrate: 256, label: "256 kbps", filesize: 22_400_000, tag: "کیفیت عالی" },
  { bitrate: 192, label: "192 kbps", filesize: 16_800_000, tag: "کیفیت عالی" },
  { bitrate: 160, label: "160 kbps", filesize: 14_000_000, tag: "کیفیت استاندارد" },
  { bitrate: 128, label: "128 kbps", filesize: 11_200_000, tag: "کیفیت استاندارد" },
  { bitrate: 96, label: "96 kbps", filesize: 8_400_000, tag: "حجم کم" },
  { bitrate: 64, label: "64 kbps", filesize: 5_600_000, tag: "حجم کم" },
];

export const demoInfo: VideoInfo = {
  id: "demo-video",
  title: "نمونه‌ی ویدئو برای نمایش طراحی رابط کاربری دانلودر یوتیوب",
  thumbnail: T_MAIN,
  duration: 212,
  uploader: "کانال نمونه",
  viewCount: 1_234_567,
  webpageUrl: "https://www.youtube.com/watch?v=demo",
  videoQualities,
  audioQualities,
  sourceAudioBitrate: 128,
};

const now = Date.now();
const min = 60_000;

export const demoActiveJobs: PublicJob[] = [
  {
    jobId: "demo-active-video",
    title: "نمونه‌ی ویدئو برای نمایش طراحی رابط کاربری دانلودر یوتیوب",
    thumbnail: T_VIDEO,
    uploader: "کانال نمونه",
    duration: 212,
    kind: "video",
    quality: "1080p",
    status: "downloading",
    progress: 46,
    fileName: "نمونه ویدئو [1080p].mp4",
    fileSize: null,
    error: null,
    createdAt: new Date(now - 2 * min),
    completedAt: null,
    downloadUrl: null,
  },
  {
    jobId: "demo-active-audio",
    title: "نمونه‌ی ویدئو برای نمایش طراحی رابط کاربری دانلودر یوتیوب",
    thumbnail: T_AUDIO,
    uploader: "کانال نمونه",
    duration: 212,
    kind: "audio",
    quality: "320kbps",
    status: "processing",
    progress: 96,
    fileName: "نمونه ویدئو [320kbps].mp3",
    fileSize: null,
    error: null,
    createdAt: new Date(now - 5 * min),
    completedAt: null,
    downloadUrl: null,
  },
];

export const demoHistory: PublicJob[] = [
  {
    jobId: "demo-done",
    title: "نمونه‌ی ویدئو برای نمایش طراحی رابط کاربری دانلودر یوتیوب",
    thumbnail: T_VIDEO2,
    uploader: "کانال نمونه",
    duration: 212,
    kind: "video",
    quality: "720p",
    status: "done",
    progress: 100,
    fileName: "نمونه ویدئو [720p].mp4",
    fileSize: 330_000_000,
    error: null,
    createdAt: new Date(now - 12 * min),
    completedAt: new Date(now - 10 * min),
    downloadUrl: "/api/jobs/demo-done/file",
  },
  {
    jobId: "demo-audio-done",
    title: "نمونه‌ی ویدئو برای نمایش طراحی رابط کاربری دانلودر یوتیوب",
    thumbnail: T_AUDIO2,
    uploader: "کانال نمونه",
    duration: 212,
    kind: "audio",
    quality: "192kbps",
    status: "done",
    progress: 100,
    fileName: "نمونه ویدئو [192kbps].mp3",
    fileSize: 16_800_000,
    error: null,
    createdAt: new Date(now - 40 * min),
    completedAt: new Date(now - 38 * min),
    downloadUrl: "/api/jobs/demo-audio-done/file",
  },
  {
    jobId: "demo-error",
    title: "ویدئوی غیرقابل دسترس",
    thumbnail: T_ERR,
    uploader: "کانال نمونه",
    duration: null,
    kind: "audio",
    quality: "128kbps",
    status: "error",
    progress: 0,
    fileName: "ویدئوی غیرقابل دسترس [128kbps].mp3",
    fileSize: null,
    error: "یوتیوب این ویدئو را در دسترس قرار نمی‌دهد (خطای ۴۰۳).",
    createdAt: new Date(now - 90 * min),
    completedAt: new Date(now - 89 * min),
    downloadUrl: null,
  },
  {
    jobId: "demo-cancelled",
    title: "نمونه‌ی ویدئو برای نمایش طراحی رابط کاربری دانلودر یوتیوب",
    thumbnail: T_MAIN,
    uploader: "کانال نمونه",
    duration: 212,
    kind: "video",
    quality: "2160p",
    status: "cancelled",
    progress: 0,
    fileName: "نمونه ویدئو [2160p].mp4",
    fileSize: null,
    error: null,
    createdAt: new Date(now - 3 * 60 * min),
    completedAt: new Date(now - 3 * 60 * min),
    downloadUrl: null,
  },
  {
    jobId: "demo-expired",
    title: "ویدئوی قدیمی",
    thumbnail: T_AUDIO,
    uploader: "کانال نمونه",
    duration: 300,
    kind: "video",
    quality: "480p",
    status: "expired",
    progress: 100,
    fileName: "ویدئوی قدیمی [480p].mp4",
    fileSize: null,
    error: null,
    createdAt: new Date(now - 26 * 60 * 60 * 1000),
    completedAt: new Date(now - 25 * 60 * 60 * 1000),
    downloadUrl: null,
  },
];
