import { argentinaDateTimeParts, ES_MONTH_ABBR } from "@/lib/tasks/argentinaDate";
import type { Locale } from "./locales";

/**
 * Shared date/time formatting, locale-aware via Intl. Replaces the
 * hand-built English-only "8mo ago" / toLocaleString() helpers that used
 * to be duplicated across src/app/page.tsx, src/app/outreach/page.tsx and
 * src/app/contact/[id]/page.tsx.
 */

const rtfAuto = new Map<Locale, Intl.RelativeTimeFormat>();
const rtfAlways = new Map<Locale, Intl.RelativeTimeFormat>();

function getRtf(locale: Locale, numeric: "auto" | "always"): Intl.RelativeTimeFormat {
  const cache = numeric === "auto" ? rtfAuto : rtfAlways;
  let rtf = cache.get(locale);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric });
    cache.set(locale, rtf);
  }
  return rtf;
}

/**
 * Coarse, human relative time ("8 months ago" / "hace 8 meses"), same
 * bucketing as before (today / days / months / years) but phrased through
 * Intl.RelativeTimeFormat instead of a hand-built English string.
 */
export function relativeTime(date: Date, locale: Locale): string {
  const ms = Date.now() - date.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return getRtf(locale, "auto").format(0, "day");
  if (days < 30) return getRtf(locale, "always").format(-days, "day");
  const months = Math.floor(days / 30);
  if (months < 24) return getRtf(locale, "always").format(-months, "month");
  const years = Math.floor(months / 12);
  return getRtf(locale, "always").format(-years, "year");
}

export function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function formatDateTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const ES_MONTH_FULL = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Argentina-pinned display helpers (launch-readiness audit fix, 2026-09-30):
 * a Server Component runs in the PROCESS timezone (UTC on Vercel), while the
 * sibling "use client" Timeline component renders the identical instant in
 * the BD's BROWSER timezone (ART) — an event between 21:00-24:00 ART used to
 * show tomorrow's date server-side (`format(at, "d MMM", { locale: es })`,
 * no timezone pinned, date-fns reads the Date object's LOCAL getters) and
 * today's date in the Timeline directly below it. Every user-facing instant
 * now goes through one of these, on BOTH server and client call sites, so
 * the same instant always displays the same Argentina-local date/time
 * regardless of which machine rendered it.
 *
 * Built on `argentinaDateTimeParts` (src/lib/tasks/argentinaDate.ts) — the
 * same fixed UTC-3, no-DST shift that module's own boundary functions rely
 * on. Do NOT use these for `task.due_at` (a bare calendar date, never a real
 * instant) — keep using `formatTaskDueDate`/`taskDueDate` for that column.
 */
export function formatArgentinaDayMonth(at: Date): string {
  const p = argentinaDateTimeParts(at);
  return `${p.day} ${ES_MONTH_ABBR[p.month - 1]}`;
}

/** "29 sep 2026". */
export function formatArgentinaDayMonthYear(at: Date): string {
  const p = argentinaDateTimeParts(at);
  return `${p.day} ${ES_MONTH_ABBR[p.month - 1]} ${p.year}`;
}

/** "29 sep, 22:30". */
export function formatArgentinaDayMonthTime(at: Date): string {
  const p = argentinaDateTimeParts(at);
  return `${p.day} ${ES_MONTH_ABBR[p.month - 1]}, ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "Septiembre 2026" — capitalized full month name (Timeline month-group headers). */
export function formatArgentinaMonthYear(at: Date): string {
  const p = argentinaDateTimeParts(at);
  const month = ES_MONTH_FULL[p.month - 1]!;
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${p.year}`;
}
