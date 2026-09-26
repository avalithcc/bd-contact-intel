/**
 * Pure planner for the "Registrar reunión" quick action (task 10.2;
 * design.md "meeting_logged {at, notes}"). No I/O — the caller writes a
 * `meeting_logged` activity with this metadata; `deriveStatus()`
 * (src/lib/status/deriveStatus.ts, `FIXED_STAGE_BY_TYPE`) already advances
 * the derived status to `meeting` for that type.
 */

export class MeetingDateRequiredError extends Error {
  constructor() {
    super("A meeting date is required");
    this.name = "MeetingDateRequiredError";
  }
}

export interface MeetingActivityMetadata {
  at: string;
  notes: string | null;
}

/** `rawDate` is a `YYYY-MM-DD` input value; `rawTime` an optional `HH:mm`, defaulting to midnight local time. */
export function planMeeting(rawDate: string, rawTime: string, rawNotes: string): MeetingActivityMetadata {
  const date = rawDate.trim();
  if (!date) throw new MeetingDateRequiredError();
  const time = rawTime.trim() || "00:00";
  const at = new Date(`${date}T${time}:00`);
  const notes = rawNotes.trim() || null;
  return { at: at.toISOString(), notes };
}
