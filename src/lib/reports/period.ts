/**
 * Pure period-boundary math for /admin/reports (owner-reporting decision 2:
 * default "Este mes", "Esta semana"/"Este trimestre" as alternatives). Every
 * boundary is an Argentina calendar-day instant (`argentinaInstantBoundary`,
 * src/lib/tasks/argentinaDate.ts) — real timestamp columns
 * (`person.created_at`, `activity.created_at`, ...) are filtered by these,
 * never by the naive 00:00-UTC scheme `argentinaDayBoundaries` uses for
 * `due_at` (a different column kind entirely).
 *
 * The upper bound is always `now`, not the calendar period's own end — a
 * report must never claim data exists for days that have not happened yet.
 * The display `label`, by contrast, names the full calendar period (owner
 * decision: "Período: 1–30 sep 2026" reads naturally even on day 30 itself).
 */
import { addDaysToDateString, argentinaCalendarDate, argentinaInstantBoundary } from "@/lib/tasks/argentinaDate";

export type ReportPeriod = "week" | "month" | "quarter";

const REPORT_PERIODS: readonly ReportPeriod[] = ["week", "month", "quarter"];

export function resolveReportPeriod(value: string | undefined): ReportPeriod {
  return (REPORT_PERIODS as readonly string[]).includes(value ?? "") ? (value as ReportPeriod) : "month";
}

export interface ReportPeriodRange {
  /** Inclusive lower bound, ISO instant. */
  fromIso: string;
  /** Exclusive upper bound, ISO instant — always `now`, never in the future. */
  toIso: string;
  /** Same lower bound as an ART calendar date, for `date`-typed columns (e.g. `follow_up_queue_item.queue_date`). */
  fromDate: string;
  /** Exclusive upper bound as an ART calendar date — the full period's own end, unlike `toIso`. */
  toDateExclusive: string;
  /** Spanish display label naming the FULL calendar period, e.g. "1–30 sep 2026". */
  label: string;
}

const ES_MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function ymd(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

function dateStrOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function monthRangeOf(y: number, m: number): { fromDate: string; toDateExclusive: string } {
  const [toY, toM] = m === 12 ? [y + 1, 1] : [y, m + 1];
  return { fromDate: dateStrOf(y, m, 1), toDateExclusive: dateStrOf(toY, toM, 1) };
}

function quarterRangeOf(y: number, m: number): { fromDate: string; toDateExclusive: string } {
  const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  return { fromDate: monthRangeOf(y, qStartMonth).fromDate, toDateExclusive: monthRangeOf(y, qStartMonth + 2).toDateExclusive };
}

/** Monday of the ART calendar week `today` falls in (ISO weekday: Monday=1..Sunday=7). */
function weekRangeOf(today: string): { fromDate: string; toDateExclusive: string } {
  const { y, m, d } = ymd(today);
  const isoWeekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
  const fromDate = addDaysToDateString(today, -(isoWeekday - 1));
  return { fromDate, toDateExclusive: addDaysToDateString(fromDate, 7) };
}

function labelOf(fromDate: string, toDateExclusive: string): string {
  const from = ymd(fromDate);
  const lastInclusiveDate = addDaysToDateString(toDateExclusive, -1);
  const to = ymd(lastInclusiveDate);
  const month = ES_MONTH_ABBR[to.m - 1];
  return from.m === to.m && from.y === to.y
    ? `${from.d}–${to.d} ${month} ${to.y}`
    : `${from.d} ${ES_MONTH_ABBR[from.m - 1]} – ${to.d} ${month} ${to.y}`;
}

export function reportPeriodRange(period: ReportPeriod, now: Date): ReportPeriodRange {
  const today = argentinaCalendarDate(now);
  const { y, m } = ymd(today);

  const { fromDate, toDateExclusive } =
    period === "week" ? weekRangeOf(today) : period === "quarter" ? quarterRangeOf(y, m) : monthRangeOf(y, m);

  return {
    fromIso: argentinaInstantBoundary(fromDate).toISOString(),
    toIso: now.toISOString(),
    fromDate,
    toDateExclusive,
    label: labelOf(fromDate, toDateExclusive),
  };
}
