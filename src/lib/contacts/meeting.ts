/**
 * Pure planner for the "Registrar reunión" quick action (task 10.2;
 * design.md "meeting_logged {at, notes}"). No I/O — the caller writes a
 * `meeting_logged` activity with this metadata; `deriveStatus()`
 * (src/lib/status/deriveStatus.ts, `FIXED_STAGE_BY_TYPE`) already advances
 * the derived status to `meeting` for that type.
 */
import { isBeyondClockSkew } from "@/lib/contacts/futureGuard";
import { argentinaWallClockToUtc } from "@/lib/tasks/argentinaDate";

export class MeetingDateRequiredError extends Error {
  constructor() {
    super("A meeting date is required");
    this.name = "MeetingDateRequiredError";
  }
}

/**
 * F12: a meeting dated in the future is REFUSED rather than saved. Why not
 * "accept it but don't count it yet": `person.status` is a cache recomputed
 * only on writes, and `deriveStatus` ignores `metadata.at` for
 * `meeting_logged` — so a future meeting accepted now would never flip the
 * contact to "Reunión" once its date passed. Silently losing the stage
 * forever is worse than refusing. A meeting she has only scheduled belongs in
 * a follow-up task (the error copy points her there).
 */
export class MeetingOccurredAtInFutureError extends Error {
  constructor() {
    super("A meeting cannot be logged with a future date/time");
    this.name = "MeetingOccurredAtInFutureError";
  }
}

export interface MeetingActivityMetadata {
  at: string;
  notes: string | null;
}

/**
 * `rawDate` is a `YYYY-MM-DD` input value; `rawTime` an optional `HH:mm`,
 * defaulting to midnight — both entered by the BD as Argentina wall-clock
 * time, converted via `argentinaWallClockToUtc` regardless of the server
 * process's own timezone (bug fix: this used to build `new Date` directly
 * from the raw strings, which the JS spec parses as LOCAL time in the
 * CALLING PROCESS's timezone — UTC on Vercel — storing every meeting 3
 * hours off from what the BD actually entered).
 *
 * `now` is only overridden by tests; it is the future guard's reference
 * point, same as in planCall.
 */
export function planMeeting(
  rawDate: string,
  rawTime: string,
  rawNotes: string,
  now: Date = new Date(),
): MeetingActivityMetadata {
  const date = rawDate.trim();
  if (!date) throw new MeetingDateRequiredError();
  const time = rawTime.trim() || "00:00";
  const at = argentinaWallClockToUtc(date, time);
  if (isBeyondClockSkew(at, now)) throw new MeetingOccurredAtInFutureError();
  const notes = rawNotes.trim() || null;
  return { at: at.toISOString(), notes };
}
