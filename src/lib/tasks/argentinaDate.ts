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
 *
 * CONTRACT (fix for the 2026-09-30 "worked today" day-boundary bug — a BD's
 * 21:00-24:00 ART activity failed the "worked today" window and the
 * follow-up badge kept counting already-worked contacts as pending):
 * this module exports TWO kinds of boundary, for two disjoint kinds of
 * column, and they are NOT interchangeable.
 *   - `argentinaDayBoundaries` / `ArgentinaDayBoundaries.todayStartUtc` /
 *     `.tomorrowStartUtc` — naive 00:00 UTC, for `due_at` ONLY (a bare
 *     calendar date, never a real instant). Every task-creation path stores
 *     `due_at` this way; see the type's own field comments.
 *   - `argentinaInstantBoundary` / `argentinaDateTimeParts` — the real UTC
 *     instant ART midnight falls on, for bounding or displaying REAL
 *     timestamp columns (`activity.created_at`, `person.created_at`, the
 *     effective activity time from `src/lib/status/deriveStatus.ts`, ...).
 * `tests/unit/argentinaDayBoundariesUsage.test.ts` enforces the due_at-only
 * half of this contract: it fails the build if a new file starts importing
 * `argentinaDayBoundaries` without being added to that test's explicit
 * allowlist, forcing a human to classify the new call site instead of
 * silently reintroducing this bug.
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

/**
 * Converts a `YYYY-MM-DD` date + `HH:mm` time — BOTH entered by a BD as
 * Argentina wall-clock values (a `<input type="date">`/`<input
 * type="time">` pair on a quick-action dialog) — into the real UTC instant
 * they represent. Generalizes `argentinaInstantBoundary`'s
 * parse-as-UTC-then-add-the-fixed-offset technique from a fixed "00:00" to
 * an arbitrary time of day.
 *
 * Bug fixed here (launch-readiness audit, `src/lib/contacts/call.ts` /
 * `meeting.ts`): those planners used to build `new Date(\`${date}T${time}:00\`)`
 * directly — no offset — which the JS spec parses as LOCAL time in the
 * CALLING PROCESS's timezone. Running server-side (UTC on Vercel), a BD
 * entering "2026-09-29 22:00" (meaning 22:00 ART) got it stored as
 * 2026-09-29T22:00:00.000Z — 3 hours later than intended — silently
 * corrupting ordering against genuinely-correct UTC instants from the Gmail
 * sync. This treats the input as ART wall-clock time explicitly, regardless
 * of the process's own timezone.
 */
export function argentinaWallClockToUtc(dateStr: string, timeStr: string): Date {
  return new Date(Date.parse(`${dateStr}T${timeStr}:00.000Z`) + ART_OFFSET_MS);
}

export interface ArgentinaDateTimeParts {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * Full Argentina-local calendar+clock parts for a REAL instant — the
 * building block for every user-facing date/time display in this app
 * (`src/lib/i18n/format.ts`'s `formatArgentina*` family), independent of the
 * process's or browser's own timezone. Same fixed UTC-3 shift as
 * `argentinaCalendarDate` (this module's governing assumption), extended to
 * the hour/minute fields a display needs. Do NOT use this for `due_at` —
 * that column is a bare calendar date, not a real instant; use
 * `formatTaskDueDate`/`taskDueDate` for it instead.
 */
export function argentinaDateTimeParts(at: Date): ArgentinaDateTimeParts {
  const shifted = new Date(at.getTime() - ART_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export interface ArgentinaInstantWindow {
  /** Inclusive lower bound — the real UTC instant ART midnight of `now`'s ART calendar day. */
  fromUtc: Date;
  /** Exclusive upper bound — the real UTC instant ART midnight of the NEXT ART calendar day. */
  toUtc: Date;
}

/**
 * The real-instant "today" window for bounding REAL timestamp columns
 * (`activity`'s effective activity time — see
 * `src/lib/status/deriveStatus.ts` — `person.created_at`, ...) by an
 * Argentina calendar day. The ONE shared helper both
 * `queueQueries.ts#workedTodayExists` and
 * `appShellBadgeCounts.ts#getAppShellBadgeCounts`'s "worked today" window
 * use, so the two call sites can never independently drift on which
 * boundary kind they pick. Fixes the 2026-09-30 bug: both used to compute
 * this window from `argentinaDayBoundaries` (the naive `due_at` scheme)
 * instead, so an activity logged ~21:00-24:00 ART fell after
 * `tomorrowStartUtc` (only 21:00 ART) and failed the window entirely.
 */
export function argentinaInstantDayWindow(now: Date): ArgentinaInstantWindow {
  const today = argentinaCalendarDate(now);
  return {
    fromUtc: argentinaInstantBoundary(today),
    toUtc: argentinaInstantBoundary(addDaysToDateString(today, 1)),
  };
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

export const ES_MONTH_ABBR = [
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
