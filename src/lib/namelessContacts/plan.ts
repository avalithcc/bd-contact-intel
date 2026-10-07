/**
 * Pure guard behind scripts/delete-nameless-imported-contacts.ts. It does not
 * write a second deletability rule: it reuses planRevert and the touch flags of
 * the commercial-contacts revert (src/lib/contactosComerciales/revert.ts), so
 * the two scripts cannot drift. A person is deletable ONLY when none of
 * TOUCH_FLAGS applies (nothing references it, it was not merged, there is no
 * history beyond the import's); anything else is kept and counted by reason.
 * Never mutates its inputs.
 */
import { planRevert, type TouchFlag } from "@/lib/contactosComerciales/revert";

export const NAMELESS_SCAN_CAP = 100;
export const NAMELESS_AUDIT_ACTION = "delete_nameless_imported_contacts";

export interface NamelessPlan {
  deletable: string[];
  kept: { id: string; reasons: TouchFlag[] }[];
  keptReasons: Partial<Record<TouchFlag, number>>;
}

/**
 * `selectedIds` are the rows the SQL selection found (source_key and both names
 * NULL); `expected` is the count the owner measured. Any other size refuses: a
 * widened or shrunken selection is a mismatch to investigate, not to act on.
 */
export function planNamelessDeletion(selectedIds: readonly string[], facts: ReadonlyMap<string, readonly TouchFlag[]>, expected: number): NamelessPlan {
  if (selectedIds.length > NAMELESS_SCAN_CAP) throw new Error(`More than ${NAMELESS_SCAN_CAP} persons match: over the cap, refusing.`);
  if (selectedIds.length !== expected) throw new Error(`Selection mismatch: expected ${expected} nameless contacts, found ${selectedIds.length}. Refusing.`);
  for (const id of selectedIds) if (!facts.has(id)) throw new Error("A selected person has no touch facts: refusing to delete it.");

  const plan = planRevert({ createdIds: selectedIds, facts, fills: [], currentPhones: new Map() });
  const keptReasons: NamelessPlan["keptReasons"] = {};
  for (const k of plan.kept) for (const r of k.reasons) keptReasons[r] = (keptReasons[r] ?? 0) + 1;
  return { deletable: plan.deletable, kept: plan.kept, keptReasons };
}
