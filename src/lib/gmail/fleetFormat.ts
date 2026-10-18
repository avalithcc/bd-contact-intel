/**
 * Date and elapsed-time text for the Gmail fleet view (mockups/estado-gmail-equipo.html): "hoy 10:42", "ayer 18:02",
 * "7 oct 2026, 16:20", "hace 2 h 31 min". Pure. Every instant is shown on the Argentina clock (argentinaDate.ts), and every
 * word comes from the caller's labels (the `gmailFleet.time` dictionary block), never from this file.
 */
import { addDaysToDateString, argentinaCalendarDate, argentinaDateTimeParts, ES_MONTH_ABBR } from "@/lib/tasks/argentinaDate";

export interface FleetTimeLabels {
  today: string;
  yesterday: string;
  /** "hace {t}". */
  ago: string;
  lessThanMinute: string;
  /** "{n} min". */
  minutes: string;
  /** "{h} h {m} min". */
  hoursMinutes: string;
  /** "{h} h". */
  hours: string;
  /** "{n} días". */
  days: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));

/** "hoy 10:42" / "ayer 18:02" / "7 oct 2026, 16:20" (or "7 oct 2026" when `timeWhenOlder` is false). */
export function formatInstant(at: Date, now: Date, labels: FleetTimeLabels, opts: { timeWhenOlder?: boolean } = {}): string {
  const { timeWhenOlder = true } = opts;
  const p = argentinaDateTimeParts(at);
  const time = `${pad2(p.hour)}:${pad2(p.minute)}`;
  const day = argentinaCalendarDate(at);
  const today = argentinaCalendarDate(now);
  if (day === today) return `${labels.today} ${time}`;
  if (addDaysToDateString(day, 1) === today) return `${labels.yesterday} ${time}`;
  const date = `${p.day} ${ES_MONTH_ABBR[p.month - 1]} ${p.year}`;
  return timeWhenOlder ? `${date}, ${time}` : date;
}

/** "hace 13 min" / "hace 2 h 31 min" / "hace 17 h" / "hace 11 días": minutes under an hour, hours (with minutes under 6 h) under two days, then days. */
export function formatAgo(ms: number, labels: FleetTimeLabels): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  let span: string;
  if (minutes < 1) span = labels.lessThanMinute;
  else if (minutes < 60) span = fill(labels.minutes, { n: minutes });
  else {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours < 6 && rest > 0) span = fill(labels.hoursMinutes, { h: hours, m: rest });
    else if (hours < 48) span = fill(labels.hours, { h: hours });
    else span = fill(labels.days, { n: Math.floor(hours / 24) });
  }
  return fill(labels.ago, { t: span });
}

/** "21 oct" from a `YYYY-MM-DD` calendar date (no instant, so no time-zone shift). */
export function formatYmdDayMonth(ymd: string): string {
  const [, month, day] = ymd.split("-").map(Number);
  return `${day} ${ES_MONTH_ABBR[month! - 1]}`;
}
