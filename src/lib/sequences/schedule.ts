import { addCalendarDays, miamiCalendarDate, miamiWallClockToUtc } from "./miamiTime";

/** Shape of `sequence.schedule` (jsonb). Only America/New_York is supported. */
export type Schedule = {
  step1: { hour: number; timezone: string; offsetDays: number };
  step2: { afterDays: number };
};

export const DEFAULT_SCHEDULE: Schedule = {
  step1: { hour: 9, timezone: "America/New_York", offsetDays: 1 },
  step2: { afterDays: 7 },
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function intIn(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** Reads the `schedule` jsonb, falling back per field to the spec's values. */
export function parseSchedule(raw: unknown): Schedule {
  const d = DEFAULT_SCHEDULE;
  const s1 = isRecord(raw) && isRecord(raw.step1) ? raw.step1 : {};
  const s2 = isRecord(raw) && isRecord(raw.step2) ? raw.step2 : {};
  return {
    step1: {
      hour: intIn(s1.hour, 0, 23, d.step1.hour),
      timezone: d.step1.timezone,
      offsetDays: intIn(s1.offsetDays, 1, 30, d.step1.offsetDays),
    },
    step2: { afterDays: intIn(s2.afterDays, 1, 60, d.step2.afterDays) },
  };
}

/** When step 1 becomes due: `offsetDays` Miami days after approval, at `hour` Miami. */
export function step1DueAt(approvedAt: Date, schedule: Schedule = DEFAULT_SCHEDULE): Date {
  const day = addCalendarDays(miamiCalendarDate(approvedAt), schedule.step1.offsetDays);
  return miamiWallClockToUtc(day, schedule.step1.hour);
}

/**
 * When the reminder becomes due: `afterDays` Miami days after the ACTUAL step 1
 * send (not after approval), so a cap-delayed send pushes the reminder.
 */
export function reminderDueAt(step1SentAt: Date, schedule: Schedule = DEFAULT_SCHEDULE): Date {
  const day = addCalendarDays(miamiCalendarDate(step1SentAt), schedule.step2.afterDays);
  return miamiWallClockToUtc(day, schedule.step1.hour);
}
