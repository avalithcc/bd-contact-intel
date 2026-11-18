import { argentinaCalendarDate } from "@/lib/tasks/argentinaDate";

export interface TenderTiming {
  /** Argentina calendar days from today to the opening day: 0 is today, negative is past. */
  daysLeft: number;
  /** The opening instant has passed. A closed tender still lists; it is marked, never hidden. */
  closed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Derived on every read from `now`; a stored day count would be wrong by tomorrow. */
export function tenderTiming(openingAt: Date, now: Date): TenderTiming {
  const open = argentinaCalendarDate(openingAt);
  const today = argentinaCalendarDate(now);
  const daysLeft = Math.round((Date.parse(`${open}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  return { daysLeft, closed: openingAt.getTime() < now.getTime() };
}
