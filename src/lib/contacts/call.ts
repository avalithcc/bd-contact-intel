/**
 * Pure planner for the "Registrar llamada" quick action (contact-record
 * mockup: outcome required, direction, optional duration, notes). No I/O —
 * the caller writes a `call` activity with this metadata;
 * `src/lib/status/deriveStatus.ts` derives the stage contribution from
 * `direction`/`outcome` (owner rule: an outbound call with any outcome is
 * contact evidence → `contacted`; an outcome of `connected` in either
 * direction is a reply → `replied`). Mirrors meeting.ts/discard.ts.
 */

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

export function isCallDirection(value: string): value is CallDirection {
  return (CALL_DIRECTIONS as readonly string[]).includes(value);
}

export class CallOutcomeRequiredError extends Error {
  constructor() {
    super("A call outcome is required");
    this.name = "CallOutcomeRequiredError";
  }
}

export interface CallActivityMetadata {
  outcome: CallOutcomeCode;
  direction: CallDirection;
  durationMinutes: number | null;
  occurredAt: string;
  notes: string | null;
}

/** `rawDurationMinutes` is a free-text `<input type="number">` value; only a
 * non-negative integer is kept, anything else (blank, negative, NaN) is
 * dropped to `null` rather than rejecting the whole call log. */
function parseDurationMinutes(rawDurationMinutes: string): number | null {
  const trimmed = rawDurationMinutes.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/**
 * `rawDate` is a `YYYY-MM-DD` input value (blank defaults to now, unlike
 * meeting.ts's required date — a call is usually logged right after it
 * happens); `rawTime` an optional `HH:mm`, defaulting to midnight local time
 * when a date IS given. An unrecognized `rawDirection` defaults to
 * `"outbound"` (same defensive default as a blank one) rather than
 * rejecting the whole log over a corrupted `<select>` value.
 */
export function planCall(
  rawOutcome: string,
  rawDirection: string,
  rawDate: string,
  rawTime: string,
  rawDurationMinutes: string,
  rawNotes: string,
): CallActivityMetadata {
  const outcome = rawOutcome.trim();
  if (!isCallOutcomeCode(outcome)) throw new CallOutcomeRequiredError();

  const direction = isCallDirection(rawDirection.trim()) ? (rawDirection.trim() as CallDirection) : "outbound";

  const date = rawDate.trim();
  const occurredAt = date
    ? new Date(`${date}T${rawTime.trim() || "00:00"}:00`).toISOString()
    : new Date().toISOString();

  const durationMinutes = parseDurationMinutes(rawDurationMinutes);
  const notes = rawNotes.trim() || null;

  return { outcome, direction, durationMinutes, occurredAt, notes };
}
