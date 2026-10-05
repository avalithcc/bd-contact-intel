/**
 * Pure rules for recording a call attempt (call-logging-one-tap, variant A).
 *
 * Clicking a `tel:` link records a `call_attempt` activity, then the outcome
 * bar asks what happened. An attempt is intent, not conversation: the browser
 * cannot tell whether the call connected. So an attempt:
 *
 * - is its own activity type, never `call` (`call` keeps meaning "there was a
 *   conversation");
 * - does NOT move the contact's status (deriveStatus.ts#STATUS_NEUTRAL_ACTIVITY_TYPES);
 * - DOES count as "última actividad" (it is not in NON_TOUCH_ACTIVITY_TYPES);
 * - does NOT count for ownership (ownerRule.ts#OWNER_IGNORED_ACTIVITY_TYPES).
 *
 * Confirming "Hablé" writes a real `call` row whose `occurredAt` is the moment
 * of the DIAL (the attempt's `created_at`), not the moment of the click on the
 * bar: a call confirmed hours later must still sort where it happened.
 */
import { CallOutcomeRequiredError, MANUAL_CALL_DIRECTION, type CallActivityMetadata } from "@/lib/contacts/call";

export const CALL_ATTEMPT_TYPE = "call_attempt";

/** A second attempt by the same BD to the same number within this window is the same dial (a double click), not a new one. */
export const CALL_ATTEMPT_DEDUPE_WINDOW_MS = 60_000;

/** The bar's note input and the server share this cap; a direct action call cannot exceed it. */
export const CALL_ATTEMPT_NOTE_MAX_LENGTH = 500;

/** Outcomes the bar can set. "connected" is the only one that writes a `call` row. */
export const ATTEMPT_OUTCOMES = ["connected", "no_answer", "voicemail"] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export type DialledField = "phone" | "mobile_phone";

export class CallAttemptResolvedError extends Error {
  constructor() {
    super("This call attempt already has an outcome");
    this.name = "CallAttemptResolvedError";
  }
}

export interface RecentAttempt {
  actorBdId: string | null;
  number: string | null;
  createdAt: Date;
}

/** Oldest `created_at` that still counts as the same dial. */
export function dedupeCutoff(now: Date): Date {
  return new Date(now.getTime() - CALL_ATTEMPT_DEDUPE_WINDOW_MS);
}

/** The attempt (among `recent`) that a new dial by `bdId` to `number` duplicates, or null. */
export function findDuplicateAttempt<T extends RecentAttempt>(
  recent: readonly T[],
  dial: { bdId: string; number: string },
  now: Date,
): T | null {
  const cutoff = dedupeCutoff(now).getTime();
  return (
    recent.find((a) => a.actorBdId === dial.bdId && a.number === dial.number.trim() && a.createdAt.getTime() >= cutoff) ?? null
  );
}

export function planAttemptMetadata(number: string, field: DialledField): { number: string; field: DialledField } {
  return { number: number.trim(), field };
}

/**
 * Which stored number was dialled. A contact can have both a landline and a
 * mobile, and later it matters which one was tried. `null` when the number is
 * neither: the server refuses to record a dial for a number the contact does
 * not have.
 */
export function resolveDialledField(
  number: string,
  stored: { phone: string | null; mobilePhone: string | null },
): DialledField | null {
  const n = number.trim();
  if (!n) return null;
  if (stored.phone?.trim() === n) return "phone";
  if (stored.mobilePhone?.trim() === n) return "mobile_phone";
  return null;
}

export function isAttemptOutcome(value: string): value is AttemptOutcome {
  return (ATTEMPT_OUTCOMES as readonly string[]).includes(value);
}

export interface AttemptResolution {
  /** Merged into the attempt's metadata. */
  attemptPatch: { outcome: AttemptOutcome };
  /** The `call` row to write, for "connected" only. */
  call: (CallActivityMetadata & { number: string | null }) | null;
}

export function planAttemptResolution(
  attempt: { createdAt: Date; metadata: unknown },
  rawOutcome: string,
  rawNotes: string,
): AttemptResolution {
  const outcome = rawOutcome.trim();
  if (!isAttemptOutcome(outcome)) throw new CallOutcomeRequiredError();
  const meta = (attempt.metadata ?? {}) as Record<string, unknown>;
  if (typeof meta.outcome === "string") throw new CallAttemptResolvedError();
  if (outcome !== "connected") return { attemptPatch: { outcome }, call: null };
  return {
    attemptPatch: { outcome },
    call: {
      outcome: "connected",
      direction: MANUAL_CALL_DIRECTION,
      // The DIAL moment, never "now".
      occurredAt: attempt.createdAt.toISOString(),
      notes: rawNotes.trim().slice(0, CALL_ATTEMPT_NOTE_MAX_LENGTH) || null,
      number: typeof meta.number === "string" ? meta.number : null,
    },
  };
}
