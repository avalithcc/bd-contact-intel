/**
 * Miami (America/New_York) calendar and wall-clock arithmetic for outreach
 * sequences.
 *
 * ASSUMPTION, the OPPOSITE of `src/lib/tasks/argentinaDate.ts`: that module
 * relies on a fixed UTC-3 offset with no DST, so a date can be read off an
 * instant by shifting a constant. America/New_York DOES observe DST (UTC-4 in
 * summer, UTC-5 in winter), so no constant shift is correct here. Every
 * conversion goes through the IANA timezone database via Intl. Do not reuse
 * or extend argentinaDate.ts for this, and do not "simplify" this file to a
 * fixed offset.
 *
 * Calendar dates are plain "YYYY-MM-DD" strings.
 */

const TIME_ZONE = "America/New_York";
const DAY_MS = 24 * 60 * 60 * 1000;

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Miami wall-clock components of an instant, as if they were UTC components. */
function miamiWallClockAsUtcMs(instant: Date): number {
  const p: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Offset of Miami from UTC at an instant, in ms (negative: behind UTC). */
function miamiOffsetMs(instant: Date): number {
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  return miamiWallClockAsUtcMs(new Date(whole)) - whole;
}

/** The Miami calendar date ("YYYY-MM-DD") on which an instant falls. */
export function miamiCalendarDate(instant: Date): string {
  return new Date(miamiWallClockAsUtcMs(instant)).toISOString().slice(0, 10);
}

/** Calendar-day arithmetic on a "YYYY-MM-DD" string; independent of any timezone. */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The UTC instant at which Miami's wall clock reads `date` `hour:minute`.
 *
 * Both DST edge cases are resolved deterministically:
 * - nonexistent local time (spring-forward gap, e.g. 02:30 on 2026-03-08):
 *   moves forward past the gap (02:30 -> 03:30 EDT).
 * - ambiguous local time (fall-back overlap, e.g. 01:30 on 2026-11-01):
 *   the first occurrence (EDT) wins.
 */
export function miamiWallClockToUtc(date: string, hour: number, minute = 0): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  // Offsets a day either side bracket any transition affecting this local time.
  const before = miamiOffsetMs(new Date(naive - DAY_MS));
  const after = miamiOffsetMs(new Date(naive + DAY_MS));
  const first = naive - before;
  if (before === after) return new Date(first);
  const second = naive - after;
  const firstValid = miamiOffsetMs(new Date(first)) === before;
  const secondValid = miamiOffsetMs(new Date(second)) === after;
  if (firstValid && secondValid) return new Date(Math.min(first, second));
  if (firstValid) return new Date(first);
  if (secondValid) return new Date(second);
  // Gap: neither interpretation is real; use the pre-transition offset.
  return new Date(first);
}

/** 09:00 Miami on the calendar day after `instant`'s Miami date. */
export function nextMiamiNineAm(instant: Date): Date {
  return miamiWallClockToUtc(addCalendarDays(miamiCalendarDate(instant), 1), 9);
}
