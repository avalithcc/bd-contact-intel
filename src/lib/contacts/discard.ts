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

/**
 * The ONE code -> dictionary-key map for the discard reasons (`contactRecord.discardReason*`). The "Descartar" dialog, the
 * record timeline and the owner report all read it, so a code cannot be labelled in one place and leak raw in another.
 * `satisfies Record<DiscardReasonCode, ...>` makes a new code a compile error until it is mapped here.
 */
export const DISCARD_REASON_LABEL_KEY = {
  wrong_profile: "discardReasonWrongProfile",
  not_interested: "discardReasonNotInterested",
  other_vendor: "discardReasonOtherVendor",
  left_company: "discardReasonLeftCompany",
  bad_data: "discardReasonBadData",
  other: "discardReasonOther",
} as const satisfies Record<DiscardReasonCode, `discardReason${string}`>;

export type DiscardReasonLabels = Record<(typeof DISCARD_REASON_LABEL_KEY)[DiscardReasonCode], string>;

/**
 * The Spanish label for a stored discard reason, or null when it is not one of the fixed codes (legacy or future value).
 * The caller decides what to show instead; the raw code is never an answer.
 */
export function discardReasonText(reason: unknown, labels: DiscardReasonLabels): string | null {
  return typeof reason === "string" && isDiscardReasonCode(reason) ? labels[DISCARD_REASON_LABEL_KEY[reason]] : null;
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
