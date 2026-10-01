/**
 * Pure planner for the "Registrar llamada" quick action (contact-record
 * mockup: outcome required, date/time, notes; direction is assumed outbound). No I/O —
 * the caller writes a `call` activity with this metadata;
 * `src/lib/status/deriveStatus.ts` derives the stage contribution from
 * `direction`/`outcome` (owner rule: an outbound call with any outcome is
 * contact evidence → `contacted`; an outcome of `connected` in either
 * direction is a reply → `replied`). Mirrors meeting.ts/discard.ts.
 */
import { argentinaWallClockToUtc } from "@/lib/tasks/argentinaDate";

// Fixed codes from the contact-record mockup's "Resultado" select.
export const CALL_OUTCOME_CODES = [
  "connected",
  "busy",
  "no_answer",
  "voicemail",
  "wrong_number",
] as const;

export type CallOutcomeCode = (typeof CALL_OUTCOME_CODES)[number];

export function isCallOutcomeCode(value: string): value is CallOutcomeCode {
  return (CALL_OUTCOME_CODES as readonly string[]).includes(value);
}

export const CALL_DIRECTIONS = ["outbound", "inbound"] as const;

export type CallDirection = (typeof CALL_DIRECTIONS)[number];

/**
 * Direction written for every call a BD logs by hand (the form has no
 * direction control: a BD logging a call made it; inbound calls arrive by
 * other paths). DO NOT drop or "clean up" this value: `callStage` in
 * src/lib/status/deriveStatus.ts maps `outbound` to `contacted` for ANY
 * outcome, and that is the only path to `contacted` for busy/no_answer/
 * voicemail/wrong_number. Without it, repeated unanswered calls would leave
 * the contact `new` (owner rule 2026-09-26, mirrors HubSpot).
 */
export const MANUAL_CALL_DIRECTION: CallDirection = "outbound";

export function isCallDirection(value: string): value is CallDirection {
  return (CALL_DIRECTIONS as readonly string[]).includes(value);
}

export class CallOutcomeRequiredError extends Error {
  constructor() {
    super("A call outcome is required");
    this.name = "CallOutcomeRequiredError";
  }
}

/**
 * Thrown by planCall (fresh-review WARNING fix) when the requested
 * date/time is more than FUTURE_CLOCK_SKEW_TOLERANCE_MS ahead of `now`: a
 * future call would skew "Última actividad" (deriveStatus.ts reads
 * metadata.occurredAt as the effective time) and the "why" status-reason
 * hint, both of which assume every recorded event already happened.
 */
export class CallOccurredAtInFutureError extends Error {
  constructor() {
    super("A call cannot be logged with a future date/time");
    this.name = "CallOccurredAtInFutureError";
  }
}

/** Small allowance for client/server clock skew — not a real grace window
 * for "logging a call slightly ahead of time". */
const FUTURE_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** Calls logged before the duration field was removed may carry an extra
 * `durationMinutes` in their stored metadata; timelineEntryBody.ts still
 * renders it, but nothing writes it any more. */
export interface CallActivityMetadata {
  outcome: CallOutcomeCode;
  direction: CallDirection;
  occurredAt: string;
  notes: string | null;
}

/**
 * `rawDate` is a `YYYY-MM-DD` input value (blank defaults to `now`, unlike
 * meeting.ts's required date — a call is usually logged right after it
 * happens); `rawTime` an optional `HH:mm`, defaulting to midnight when a
 * date IS given. Both are entered by the BD as Argentina wall-clock time,
 * converted via `argentinaWallClockToUtc` regardless of the server
 * process's own timezone (bug fix: this used to build `new Date` directly
 * from the raw strings, which the JS spec parses as LOCAL time in the
 * CALLING PROCESS's timezone — UTC on Vercel — storing every explicit
 * date/time call log 3 hours off from what the BD actually entered,
 * corrupting ordering against genuinely-correct UTC instants from the Gmail
 * sync). An unrecognized `rawDirection` defaults to `"outbound"` (same
 * defensive default as a blank one) rather than rejecting the whole log
 * over a corrupted `<select>` value.
 *
 * `now` defaults to the real current time and is only ever overridden by
 * tests — it is BOTH the "blank date" fallback and the future-date guard's
 * reference point, so the two can never disagree about what "now" means.
 */
export function planCall(
  rawOutcome: string,
  rawDirection: string,
  rawDate: string,
  rawTime: string,
  rawNotes: string,
  now: Date = new Date(),
): CallActivityMetadata {
  const outcome = rawOutcome.trim();
  if (!isCallOutcomeCode(outcome)) throw new CallOutcomeRequiredError();

  const direction = isCallDirection(rawDirection.trim()) ? (rawDirection.trim() as CallDirection) : "outbound";

  const date = rawDate.trim();
  const occurredAtDate = date ? argentinaWallClockToUtc(date, rawTime.trim() || "00:00") : now;

  if (occurredAtDate.getTime() - now.getTime() > FUTURE_CLOCK_SKEW_TOLERANCE_MS) {
    throw new CallOccurredAtInFutureError();
  }

  const notes = rawNotes.trim() || null;

  return { outcome, direction, occurredAt: occurredAtDate.toISOString(), notes };
}
