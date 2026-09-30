/**
 * Argentina calendar-day arithmetic for the task digest (owner decision:
 * daily digest at 08:30 America/Argentina/Buenos_Aires, "today"/"yesterday"
 * are ART calendar days, never UTC days).
 *
 * America/Argentina/Buenos_Aires has been a fixed UTC-3 offset with no DST
 * since 2009, so a calendar date in that zone can be read off an instant by
 * shifting it back 3 hours and taking the UTC date components — no timezone
 * database or library needed. This is the one thing every function below
 * relies on; do not swap in a DST-aware library without re-checking that
 * assumption.
 */

const ART_OFFSET_MS = 3 * 60 * 60 * 1000;

/** `YYYY-MM-DD` calendar date this instant falls on in America/Argentina/Buenos_Aires. */
export function argentinaCalendarDate(at: Date): string {
  const shifted = new Date(at.getTime() - ART_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** Adds (or subtracts, with a negative `days`) whole days to a `YYYY-MM-DD` string. */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = Date.UTC(y!, m! - 1, d!);
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface ArgentinaDayBoundaries {
  /** Today's ART calendar date, e.g. "2026-09-29". */
  today: string;
  /** Yesterday's ART calendar date. */
  yesterday: string;
  /**
   * `due_at` value a task due TODAY would hold. Every task-creation path
   * stores `due_at` as a plain calendar date at 00:00 UTC (a date-only
   * `<input type="date">` parsed with `new Date("YYYY-MM-DD")`) — it is
   * never a real ART instant, so this boundary must NOT be ART midnight
   * (which would be 03:00 UTC). `due_at < todayStartUtc` means the task's
   * due calendar date is strictly before today, i.e. overdue.
   */
  todayStartUtc: Date;
  /**
   * `due_at` value a task due TOMORROW would hold, i.e. tomorrow's calendar
   * date at 00:00 UTC. Every open task due today or earlier satisfies
   * `due_at < tomorrowStartUtc`. Bug fixed here: this used to be ART
   * midnight tomorrow (03:00 UTC), which is >= a due-tomorrow task's actual
   * `due_at` (00:00 UTC) and so wrongly counted it as due today (production
   * 2026-09-29 digest dry run / sidebar badge). Used to bound the digest's
   * SQL read and the sidebar badge count.
   */
  tomorrowStartUtc: Date;
}

/**
 * The real UTC instant ART midnight falls on for a given `YYYY-MM-DD`
 * calendar date — the inverse of `argentinaCalendarDate`. Unlike
 * `ArgentinaDayBoundaries.todayStartUtc`/`tomorrowStartUtc` (deliberately
 * naive 00:00 UTC, matching `due_at`'s calendar-date-only encoding), this is
 * for bounding REAL timestamp columns (`activity.created_at`,
 * `person.created_at`, ...) by an Argentina calendar-day or period boundary
 * (owner-reporting: report period ranges). Do not swap this in for
 * `argentinaDayBoundaries`'s own boundaries — that would reintroduce the bug
 * that function's own doc comment describes.
 */
export function argentinaInstantBoundary(dateStr: string): Date {
  return new Date(Date.parse(`${dateStr}T00:00:00.000Z`) + ART_OFFSET_MS);
}

export function argentinaDayBoundaries(now: Date): ArgentinaDayBoundaries {
  const today = argentinaCalendarDate(now);
  const yesterday = addDaysToDateString(today, -1);
  const tomorrow = addDaysToDateString(today, 1);
  const todayStartUtc = new Date(`${today}T00:00:00.000Z`);
  const tomorrowStartUtc = new Date(`${tomorrow}T00:00:00.000Z`);
  return { today, yesterday, todayStartUtc, tomorrowStartUtc };
}

/**
 * The calendar date `due_at` represents, read directly off its UTC date
 * fields — NOT shifted by the ART offset the way `argentinaCalendarDate`
 * shifts a real instant like "now". `due_at` is never a real instant: every
 * task-creation path stores it as a bare calendar date at 00:00 UTC. Reading
 * it back through the ART-instant shift (subtract 3h) pushes it one day
 * back — the exact bug found in production 2026-09-29 (a task due today
 * showed as "de ayer", a task due yesterday as "atrasada"). Uses UTC getters
 * (not `getDate()`/`getMonth()`) so the result never depends on the calling
 * process's local timezone.
 */
export function taskDueDate(dueAt: Date): string {
  const y = dueAt.getUTCFullYear();
  const m = String(dueAt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dueAt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const ES_MONTH_ABBR = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/**
 * Displays a task's due date as "29 sep" — the stored UTC calendar date,
 * independent of the viewer's or server's timezone (rule: a due date is a
 * calendar date, not an instant). Do not reuse this for real-instant
 * timestamps (createdAt, activity times, etc.) — those should keep using
 * `date-fns`'s `format` with the ART display convention already in place.
 */
export function formatTaskDueDate(dueAt: Date): string {
  const day = dueAt.getUTCDate();
  const month = ES_MONTH_ABBR[dueAt.getUTCMonth()];
  return `${day} ${month}`;
}
