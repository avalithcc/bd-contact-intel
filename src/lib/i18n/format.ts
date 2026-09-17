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
