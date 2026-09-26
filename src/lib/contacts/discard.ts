/**
 * Pure planner for the "Descartar contacto" quick action (tasks 10.3/10.4;
 * design.md "discarded {reason: fixed codes, note (required when reason is
 * `other`)}"). No I/O — the caller writes a `discarded` activity with this
 * metadata; `deriveStatus()` (src/lib/status/deriveStatus.ts) already treats
 * that type as a discard event.
 */

// Fixed codes confirmed by the owner (2026-09-24) — see mockups/GLOSSARY.md
// "Reason" and design.md's discard reason list for the matching Spanish
// labels (src/lib/contacts/labels.ts carries the display mapping).
export const DISCARD_REASON_CODES = [
  "wrong_profile",
  "not_interested",
  "other_vendor",
  "left_company",
  "bad_data",
  "other",
] as const;

export type DiscardReasonCode = (typeof DISCARD_REASON_CODES)[number];

export function isDiscardReasonCode(value: string): value is DiscardReasonCode {
  return (DISCARD_REASON_CODES as readonly string[]).includes(value);
}

export class DiscardReasonRequiredError extends Error {
  constructor() {
    super("A discard reason is required");
    this.name = "DiscardReasonRequiredError";
  }
}

export class DiscardNoteRequiredError extends Error {
  constructor() {
    super("A note is required when the discard reason is 'other'");
    this.name = "DiscardNoteRequiredError";
  }
}

export interface DiscardActivityMetadata {
  reason: DiscardReasonCode;
  note: string | null;
}

export function planDiscard(reason: string | null, rawNote: string): DiscardActivityMetadata {
  if (!reason || !isDiscardReasonCode(reason)) throw new DiscardReasonRequiredError();
  const note = rawNote.trim() || null;
  if (reason === "other" && !note) throw new DiscardNoteRequiredError();
  return { reason, note };
}
