/**
 * Pure period-boundary math for /admin/reports (owner-reporting decision 2:
 * default "Este mes", "Esta semana"/"Este trimestre" as alternatives). Every
 * boundary is an Argentina calendar-day instant (`argentinaInstantBoundary`,
 * src/lib/tasks/argentinaDate.ts) — real timestamp columns
 * (`person.created_at`, `activity.created_at`, ...) are filtered by these,
 * never by the naive 00:00-UTC scheme `argentinaDayBoundaries` uses for
 * `due_at` (a different column kind entirely).
 *
 * The upper bound is the period's own end or `now`, whichever is earlier — a
 * report must never claim data exists for days that have not happened yet
 * (current periods end at `now`; look-back periods and custom ranges end at their own end).
 * The display `label`, by contrast, names the full calendar period (owner
 * decision: "Período: 1–30 sep 2026" reads naturally even on day 30 itself).
 */
import { addDaysToDateString, argentinaCalendarDate, argentinaInstantBoundary } from "@/lib/tasks/argentinaDate";

export type ReportPeriod = "week" | "month" | "quarter" | "last_week" | "last_month" | "last_quarter" | "custom";

const REPORT_PERIODS: readonly ReportPeriod[] = ["week", "month", "quarter", "last_week", "last_month", "last_quarter", "custom"];

/** A custom "Desde–Hasta" range as ART calendar dates, both inclusive. */
export interface CustomRange {
  from: string;
  to: string;
}

/** Longest custom range accepted; keeps every report read bounded. */
const MAX_CUSTOM_DAYS = 400;

/** Server-side guard for the drill-down actions: both instants parse, `from` < `to`, and the window is no longer than the longest custom range. */
export function isValidReportWindow(fromIso: string, toIso: string): boolean {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  return Number.isFinite(from) && Number.isFinite(to) && from < to && to - from <= (MAX_CUSTOM_DAYS + 1) * 24 * 60 * 60 * 1000;
}

function isRealDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDaysToDateString(value, 0) === value;
}

/** Validates the `from`/`to` URL params: both real dates, ordered, at most MAX_CUSTOM_DAYS apart. Null otherwise. */
export function parseCustomRange(from: string | undefined, to: string | undefined): CustomRange | null {
  if (!isRealDate(from) || !isRealDate(to) || from > to) return null;
  return addDaysToDateString(from, MAX_CUSTOM_DAYS) < to ? null : { from, to };
}

export function resolveReportPeriod(value: string | undefined): ReportPeriod {
  return (REPORT_PERIODS as readonly string[]).includes(value ?? "") ? (value as ReportPeriod) : "month";
}

export interface ReportPeriodRange {
  /** Inclusive lower bound, ISO instant. */
  fromIso: string;
  /** Exclusive upper bound, ISO instant — the period end or `now`, whichever is earlier; never in the future. */
  toIso: string;
  /** Exclusive upper bound of the FULL period, ISO instant: unlike `toIso` it can be in the future (meetings still ahead). */
  endIso: string;
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

function previousOf(fromDate: string, rangeOf: (y: number, m: number) => { fromDate: string; toDateExclusive: string }) {
  const { y, m } = ymd(addDaysToDateString(fromDate, -1));
  return rangeOf(y, m);
}

export function reportPeriodRange(period: ReportPeriod, now: Date, custom?: CustomRange | null): ReportPeriodRange {
  const today = argentinaCalendarDate(now);
  const { y, m } = ymd(today);

  const current = {
    week: weekRangeOf(today),
    month: monthRangeOf(y, m),
    quarter: quarterRangeOf(y, m),
  };
  let bounds: { fromDate: string; toDateExclusive: string };
  switch (period) {
    case "week":
    case "month":
    case "quarter":
      bounds = current[period];
      break;
    case "last_week":
      bounds = weekRangeOf(addDaysToDateString(current.week.fromDate, -1));
      break;
    case "last_month":
      bounds = previousOf(current.month.fromDate, monthRangeOf);
      break;
    case "last_quarter":
      bounds = previousOf(current.quarter.fromDate, quarterRangeOf);
      break;
    case "custom":
      // An invalid/missing range falls back to the month, same as an unknown period.
      bounds = custom ? { fromDate: custom.from, toDateExclusive: addDaysToDateString(custom.to, 1) } : current.month;
      break;
  }

  // The upper bound is the period's own end, but never later than now (a report must not claim days that have not happened).
  const endInstant = argentinaInstantBoundary(bounds.toDateExclusive);
  return {
    fromIso: argentinaInstantBoundary(bounds.fromDate).toISOString(),
    toIso: (endInstant < now ? endInstant : now).toISOString(),
    endIso: endInstant.toISOString(),
    fromDate: bounds.fromDate,
    toDateExclusive: bounds.toDateExclusive,
    label: labelOf(bounds.fromDate, bounds.toDateExclusive),
  };
}
