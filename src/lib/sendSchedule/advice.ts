/**
 * The non-blocking disclaimer of the send control (owner rule 2026-10-19). Explicit choices are always respected; this only
 * says, in the RECIPIENT's local time, that the send falls before 9:00 or on a Saturday or Sunday, and offers 9:00 of the
 * next business day. A recipient with no known place falls back to Miami for Sequences (`fallbackZone`) and to no
 * disclaimer at all for a one-off email (`fallbackZone` null). Pure.
 */
import type { Slot } from "./time";
import { localAdvisory, suggestBusinessDay, type RecipientZone } from "./zones";

export interface SendRecipient {
  name: string;
  zone: RecipientZone | null;
}

export type Advice =
  | { kind: "single"; name: string; place: string; clock: string; weekday: number; early: boolean; weekend: boolean; suggestion: { slot: Slot; weekday: number } | null }
  | { kind: "miami"; clock: string; weekday: number; early: boolean; weekend: boolean; suggestion: { slot: Slot; weekday: number } | null }
  | { kind: "bulk"; n: number; total: number };

/** The zone a Sequence recipient with no known place is judged in: the sender's own market. */
export const MIAMI_ZONE = "America/New_York";

export function buildAdvice(instant: Date, recipients: readonly SendRecipient[], fallbackZone: string | null): Advice | null {
  if (recipients.length > 1) {
    const n = recipients.filter((r) => {
      const zone = r.zone?.zone ?? fallbackZone;
      return zone !== null && localAdvisory(instant, zone) !== null;
    }).length;
    return n > 0 ? { kind: "bulk", n, total: recipients.length } : null;
  }
  const only = recipients[0];
  if (!only) return null;
  const zone = only.zone?.zone ?? fallbackZone;
  if (!zone) return null;
  const advisory = localAdvisory(instant, zone);
  if (!advisory) return null;
  const s = suggestBusinessDay(instant, zone);
  const suggestion = s ? { slot: s.slot, weekday: s.weekday } : null;
  const facts = { clock: advisory.clock, weekday: advisory.weekday, early: advisory.early, weekend: advisory.weekend, suggestion };
  return only.zone ? { kind: "single", name: only.name, place: only.zone.place, ...facts } : { kind: "miami", ...facts };
}
