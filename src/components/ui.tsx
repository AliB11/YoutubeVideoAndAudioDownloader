"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { IconAlert, IconCheck, IconSpinner, IconX } from "@/components/icons";
import { faNum } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/*                                  سطوح                                      */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div";
}) {
  return (
    <Tag
      className={`rounded-2xl border border-white/10 bg-slate-900/55 shadow-xl shadow-black/30 ring-1 ring-inset ring-white/[0.04] backdrop-blur-xl ${className}`}
    >
      {children}
    </Tag>
  );
}

export function SectionHeader({
  icon,
  title,
  badge,
  action,
}: {
  icon?: ReactNode;
  title: string;
  badge?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        {icon ? <span className="text-slate-400">{icon}</span> : null}
        {title}
        {badge}
      </h3>
      {action}
    </div>
  );
}

export function Chip({
  children,
  tone = "slate",
  className = "",
}: {
  children: ReactNode;
  tone?: "slate" | "red" | "emerald" | "amber" | "sky" | "violet";
  className?: string;
}) {
  const tones: Record<string, string> = {
    slate: "bg-white/5 text-slate-300 ring-white/10",
    red: "bg-red-500/10 text-red-200 ring-red-500/30",
    emerald: "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30",
    amber: "bg-amber-500/10 text-amber-200 ring-amber-500/30",
    sky: "bg-sky-500/10 text-sky-200 ring-sky-500/30",
    violet: "bg-violet-500/10 text-violet-200 ring-violet-500/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*                              نوار پیشرفت                                   */
/* -------------------------------------------------------------------------- */

export function ProgressBar({
  value,
  tone = "red",
  animated = false,
  label,
}: {
  value: number;
  tone?: "red" | "emerald" | "amber";
  animated?: boolean;
  label?: string;
}) {
  const tones: Record<string, string> = {
    red: "from-red-500 to-rose-500",
    emerald: "from-emerald-500 to-teal-400",
    amber: "from-amber-500 to-orange-400",
  };
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-white/10"
    >
      <div
        className={`h-full rounded-full bg-gradient-to-l ${tones[tone]} transition-[width] duration-500 ease-out ${
          animated ? "progress-shimmer" : ""
        }`}
        style={{ width: `${Math.max(clamped === 0 ? 0 : 3, clamped)}%` }}
      />
    </div>
  );
}

export function PercentText({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`tabular ${className}`}>{faNum(Math.round(value))}٪</span>;
}

/* -------------------------------------------------------------------------- */
/*                                 توست‌ها                                    */
/* -------------------------------------------------------------------------- */

export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

let toastId = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = ++toastId;
      setToasts((prev) => [...prev.slice(-3), { id, tone, title, description }]);
      const timer = window.setTimeout(
        () => dismiss(id),
        tone === "error" ? 8000 : tone === "success" ? 6000 : 4500,
      );
      timers.current.push(timer);
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, []);

  return { toasts, push, dismiss };
}

export function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4"
      role="region"
      aria-live="polite"
      aria-label="پیام‌های سامانه"
    >
      {toasts.map((toast) => {
        const tones: Record<ToastTone, string> = {
          success: "border-emerald-500/40 bg-emerald-950/80 text-emerald-100",
          error: "border-red-500/40 bg-red-950/80 text-red-100",
          info: "border-sky-500/40 bg-sky-950/80 text-sky-100",
        };
        const icons: Record<ToastTone, ReactNode> = {
          success: <IconCheck className="h-4 w-4" />,
          error: <IconAlert className="h-4 w-4" />,
          info: <IconSpinner className="h-4 w-4" />,
        };
        return (
          <div
            key={toast.id}
            className={`animate-fade-up pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur ${tones[toast.tone]}`}
          >
            <span className="mt-0.5 shrink-0">{icons[toast.tone]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 text-xs leading-5 opacity-80">{toast.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 rounded-lg p-1 opacity-70 transition hover:bg-white/10 hover:opacity-100"
              aria-label="بستن پیام"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
