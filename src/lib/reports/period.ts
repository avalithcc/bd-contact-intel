/**
 * Pure period-boundary math for /admin/reports (owner-reporting decision 2:
 * default "Este mes", "Esta semana"/"Mes pasado"/a custom range as alternatives). Every
 * boundary is an Argentina calendar-day instant (`argentinaInstantBoundary`,
 * src/lib/tasks/argentinaDate.ts) — real timestamp columns
 * (`person.created_at`, `activity.created_at`, ...) are filtered by these,
 * never by the naive 00:00-UTC scheme `argentinaDayBoundaries` uses for
 * `due_at` (a different column kind entirely).
 *
 * The upper bound is the period's own end or `now`, whichever is earlier — a
 * report must never claim data exists for days that have not happened yet
 * (current periods end at `now`; look-back periods and custom ranges end at their own end).
 * The display `label` follows the same rule: a period still running ends today
 * ("lun 19 – jue 22 oct"), never at the end of the week or month.
 */
import { addDaysToDateString, argentinaCalendarDate, argentinaInstantBoundary } from "@/lib/tasks/argentinaDate";

/** The presets the picker offers, plus a custom range. Removed values (quarter, last_week, last_quarter) in an old URL fall back to "month". */
export type ReportPeriod = "week" | "month" | "last_month" | "custom";

const REPORT_PERIODS: readonly ReportPeriod[] = ["week", "month", "last_month", "custom"];

/** A custom "Desde–Hasta" range as ART calendar dates, both inclusive. */
export interface CustomRange {
  from: string;
  to: string;
}

/** Longest custom range accepted; keeps every report read bounded. */
export const MAX_CUSTOM_DAYS = 400;

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

/**
 * Validates the `from`/`to` URL params: both real dates, ordered, at most MAX_CUSTOM_DAYS apart. With `now`, an end later than
 * tomorrow (ART) is refused too: the calendar never offers a future day, so such a URL was typed by hand. Null otherwise.
 */
export function parseCustomRange(from: string | undefined, to: string | undefined, now?: Date): CustomRange | null {
  if (!isRealDate(from) || !isRealDate(to) || from > to) return null;
  if (addDaysToDateString(from, MAX_CUSTOM_DAYS) < to) return null;
  if (now && to > addDaysToDateString(argentinaCalendarDate(now), 1)) return null;
  return { from, to };
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
  /** Last day the report covers (ART, inclusive): the period's own last day, or today for a period still running. */
  lastDate: string;
  /** Spanish display label. A running period ends today ("lun 19 – jue 22 oct", "1 – 19 oct", "lun 19 oct (hoy)"); a closed one names its full range. */
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

/** Monday of the ART calendar week `today` falls in (ISO weekday: Monday=1..Sunday=7). */
function weekRangeOf(today: string): { fromDate: string; toDateExclusive: string } {
  const { y, m, d } = ymd(today);
  const isoWeekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
  const fromDate = addDaysToDateString(today, -(isoWeekday - 1));
  return { fromDate, toDateExclusive: addDaysToDateString(fromDate, 7) };
}

const ES_WEEKDAY_ABBR = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function weekdayOf(dateStr: string): string {
  const { y, m, d } = ymd(dateStr);
  return ES_WEEKDAY_ABBR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** "1 – 30 sep 2026" / "1 oct – 19 oct 2026": a closed range (a past month, a custom range). */
function closedLabelOf(fromDate: string, lastDate: string, forceFull: boolean): string {
  const from = ymd(fromDate);
  const to = ymd(lastDate);
  if (from.d === to.d && from.m === to.m && from.y === to.y) return `${to.d} ${ES_MONTH_ABBR[to.m - 1]} ${to.y}`;
  if (!forceFull && from.m === to.m && from.y === to.y) return `${from.d} – ${to.d} ${ES_MONTH_ABBR[to.m - 1]} ${to.y}`;
  const fromYear = from.y === to.y ? "" : ` ${from.y}`;
  return `${from.d} ${ES_MONTH_ABBR[from.m - 1]}${fromYear} – ${to.d} ${ES_MONTH_ABBR[to.m - 1]} ${to.y}`;
}

/** A period still running ends today: "lun 19 oct (hoy)" for one day, "lun 19 – jue 22 oct" for a week, "1 – 19 oct" for a month. */
function runningLabelOf(period: "week" | "month", fromDate: string, today: string): string {
  const from = ymd(fromDate);
  const to = ymd(today);
  const toText = `${to.d} ${ES_MONTH_ABBR[to.m - 1]}`;
  if (fromDate === today) return `${weekdayOf(today)} ${toText} (hoy)`;
  if (period === "month") return `${from.d} – ${toText}`;
  const fromText = from.m === to.m ? `${weekdayOf(fromDate)} ${from.d}` : `${weekdayOf(fromDate)} ${from.d} ${ES_MONTH_ABBR[from.m - 1]}`;
  return `${fromText} – ${weekdayOf(today)} ${toText}`;
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
  };
  let bounds: { fromDate: string; toDateExclusive: string };
  switch (period) {
    case "week":
    case "month":
      bounds = current[period];
      break;
    case "last_month":
      bounds = previousOf(current.month.fromDate, monthRangeOf);
      break;
    case "custom":
      // An invalid/missing range falls back to the month, same as an unknown period.
      bounds = custom ? { fromDate: custom.from, toDateExclusive: addDaysToDateString(custom.to, 1) } : current.month;
      break;
  }

  // The upper bound is the period's own end, but never later than now (a report must not claim days that have not happened).
  const endInstant = argentinaInstantBoundary(bounds.toDateExclusive);
  const ownLast = addDaysToDateString(bounds.toDateExclusive, -1);
  const lastDate = ownLast < today ? ownLast : today;
  return {
    fromIso: argentinaInstantBoundary(bounds.fromDate).toISOString(),
    toIso: (endInstant < now ? endInstant : now).toISOString(),
    endIso: endInstant.toISOString(),
    fromDate: bounds.fromDate,
    toDateExclusive: bounds.toDateExclusive,
    lastDate,
    label:
      period === "week" || period === "month"
        ? runningLabelOf(period, bounds.fromDate, today)
        : closedLabelOf(bounds.fromDate, lastDate, period === "custom"),
  };
}
