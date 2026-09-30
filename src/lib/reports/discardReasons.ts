/**
 * "Descartes por motivo" (owner-reporting decision 3). Production volume is
 * near-zero, so this is a compact table over the real 6 fixed codes
 * (src/lib/contacts/discard.ts's DISCARD_REASON_CODES) with the REAL
 * per-code count — never a bar chart or an "illustrative" guess, since a
 * real `GROUP BY` already tells us exactly which code(s) occurred. An
 * unrecognized `reason` value (should not happen; the discard flow only
 * ever writes one of the 6 codes) is dropped rather than silently inflating
 * a "total" that then wouldn't match any single row.
 */
import { DISCARD_REASON_CODES, type DiscardReasonCode, isDiscardReasonCode } from "@/lib/contacts/discard";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/** Reuses the exact labels the "Descartar contacto" dialog itself shows (dict.contactRecord) — never redefined here. */
export function discardReasonLabel(reason: DiscardReasonCode, dict: Dictionary): string {
  const key = {
    wrong_profile: "discardReasonWrongProfile",
    not_interested: "discardReasonNotInterested",
    other_vendor: "discardReasonOtherVendor",
    left_company: "discardReasonLeftCompany",
    bad_data: "discardReasonBadData",
    other: "discardReasonOther",
  } as const satisfies Record<DiscardReasonCode, keyof Dictionary["contactRecord"]>;
  return dict.contactRecord[key[reason]] as string;
}

export interface DiscardReasonCount {
  reason: string;
  count: number;
}

export interface DiscardReasonRow {
  reason: DiscardReasonCode;
  count: number;
}

export function buildDiscardReasonRows(rows: readonly DiscardReasonCount[]): DiscardReasonRow[] {
  const countByReason = new Map<DiscardReasonCode, number>(DISCARD_REASON_CODES.map((r) => [r, 0]));
  for (const row of rows) {
    if (!isDiscardReasonCode(row.reason)) continue;
    countByReason.set(row.reason, (countByReason.get(row.reason) ?? 0) + row.count);
  }
  return DISCARD_REASON_CODES.map((reason) => ({ reason, count: countByReason.get(reason)! }));
}

export function totalDiscardCount(rows: readonly DiscardReasonRow[]): number {
  return rows.reduce((sum, r) => sum + r.count, 0);
}
