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
   * The UTC instant of ART midnight tomorrow — every task due strictly
   * before this instant is due today or earlier in ART. Used to bound the
   * digest's SQL read (`due_at < tomorrowStartUtc`) without needing a
   * per-row date computation in Postgres.
   */
  tomorrowStartUtc: Date;
}

export function argentinaDayBoundaries(now: Date): ArgentinaDayBoundaries {
  const today = argentinaCalendarDate(now);
  const yesterday = addDaysToDateString(today, -1);
  const tomorrow = addDaysToDateString(today, 1);
  // ART midnight on `tomorrow` = that same calendar day at 03:00 UTC
  // (UTC-3 offset, no DST).
  const tomorrowStartUtc = new Date(`${tomorrow}T${String(3).padStart(2, "0")}:00:00.000Z`);
  return { today, yesterday, tomorrowStartUtc };
}
