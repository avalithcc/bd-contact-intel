/**
 * Pure planner for the "WhatsApp" quick action (whatsapp-como-actividad
 * mockup: outcome required, date/time, notes). No I/O — the caller writes a
 * `whatsapp` activity with this metadata; `src/lib/status/deriveStatus.ts`
 * derives the stage contribution from `outcome` alone (`sent` → contacted,
 * `replied` → replied, `no_whatsapp` → none). Unlike a call there is NO
 * direction: the outcome itself says who wrote. Mirrors call.ts.
 *
 * This logs by hand. Nothing reads WhatsApp, and the nine historical `call`
 * rows that are really chats are not converted.
 */
import { isBeyondClockSkew } from "@/lib/contacts/futureGuard";
import { argentinaWallClockToUtc } from "@/lib/tasks/argentinaDate";

// Fixed codes from the whatsapp-como-actividad mockup's three buttons.
export const WHATSAPP_OUTCOME_CODES = ["sent", "replied", "no_whatsapp"] as const;

export type WhatsAppOutcomeCode = (typeof WHATSAPP_OUTCOME_CODES)[number];

export function isWhatsAppOutcomeCode(value: string): value is WhatsAppOutcomeCode {
  return (WHATSAPP_OUTCOME_CODES as readonly string[]).includes(value);
}

export class WhatsAppOutcomeRequiredError extends Error {
  constructor() {
    super("A WhatsApp outcome is required");
    this.name = "WhatsAppOutcomeRequiredError";
  }
}

/**
 * Thrown by planWhatsApp when the requested date/time is beyond the clock-skew
 * tolerance ahead of `now`: a future entry would skew "Última actividad"
 * (deriveStatus.ts reads metadata.occurredAt as the effective time), which
 * assumes every recorded event already happened. Same guard as planCall.
 */
export class WhatsAppOccurredAtInFutureError extends Error {
  constructor() {
    super("A WhatsApp message cannot be logged with a future date/time");
    this.name = "WhatsAppOccurredAtInFutureError";
  }
}

export interface WhatsAppActivityMetadata {
  outcome: WhatsAppOutcomeCode;
  occurredAt: string;
  notes: string | null;
}

/**
 * `rawDate` is a `YYYY-MM-DD` input value (blank defaults to `now`: a chat is
 * usually logged right after it happens); `rawTime` an optional `HH:mm`,
 * midnight when a date IS given. Both are Argentina wall-clock, converted via
 * `argentinaWallClockToUtc`: calling `new Date` on the raw strings parses them
 * as LOCAL time of the calling process (UTC on Vercel) and stores every
 * explicit date/time 3 hours off, corrupting ordering against true UTC
 * instants (see planCall).
 *
 * `now` is only ever overridden by tests — it is BOTH the "blank date"
 * fallback and the future guard's reference, so the two cannot disagree.
 */
export function planWhatsApp(
  rawOutcome: string,
  rawDate: string,
  rawTime: string,
  rawNotes: string,
  now: Date = new Date(),
): WhatsAppActivityMetadata {
  const outcome = rawOutcome.trim();
  if (!isWhatsAppOutcomeCode(outcome)) throw new WhatsAppOutcomeRequiredError();

  const date = rawDate.trim();
  const occurredAtDate = date ? argentinaWallClockToUtc(date, rawTime.trim() || "00:00") : now;

  if (isBeyondClockSkew(occurredAtDate, now)) {
    throw new WhatsAppOccurredAtInFutureError();
  }

  const notes = rawNotes.trim() || null;

  return { outcome, occurredAt: occurredAtDate.toISOString(), notes };
}

/** `no_whatsapp` is stored under its own type, the way an unanswered dial is `call_attempt` and not a `call`. */
export const WHATSAPP_NO_CHANNEL_TYPE = "whatsapp_no_channel";

/**
 * Picks the `activity.type` for a planned entry. "No tiene WhatsApp" reached no one, so it must not count as worked,
 * close a Seguimientos cycle or transfer ownership (mockup section 2: "¿Cierra el ciclo? no"). Every hand-kept list of
 * types (WORKED_ACTIVITY_TYPES, NO_PROGRESS_ACTIVITY_TYPES, reports) stays type-level only because that outcome is its
 * own type: do NOT fold it back into `whatsapp` and split on `metadata.outcome` in each list.
 *
 * FAILS CLOSED, like isAllowedWorkEmail: only the two outcomes that really reached someone map to `whatsapp`, and
 * anything else — unknown, missing, a corrupted stored value, a future outcome code somebody forgets to handle here —
 * falls to the inert type. Written the other way round (`=== "no_whatsapp" ? inert : "whatsapp"`) a garbage outcome
 * would land on the type that closes cycles and transfers ownership, which is the bug this split exists to prevent.
 * Unreachable today because planWhatsApp throws on anything else; one refactor away from reachable.
 */
export function whatsappActivityType(outcome: WhatsAppOutcomeCode): "whatsapp" | typeof WHATSAPP_NO_CHANNEL_TYPE {
  return outcome === "sent" || outcome === "replied" ? "whatsapp" : WHATSAPP_NO_CHANNEL_TYPE;
}
