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
import { DISCARD_REASON_CODES, DISCARD_REASON_LABEL_KEY, type DiscardReasonCode, isDiscardReasonCode } from "@/lib/contacts/discard";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/** Reuses the exact labels the "Descartar contacto" dialog itself shows (dict.contactRecord) through the one shared map in discard.ts. */
export function discardReasonLabel(reason: DiscardReasonCode, dict: Dictionary): string {
  return dict.contactRecord[DISCARD_REASON_LABEL_KEY[reason]];
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
