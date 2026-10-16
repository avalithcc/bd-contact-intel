/**
 * Display for the Contact record's derived "Grupo de rol" row. The column
 * stores the closed RoleGroupKey enum; the label lives in the dictionary. The
 * row always shows the STORED group (what filters, Sequences and reports use);
 * when the current Cargo classifies elsewhere the hint says so instead of the
 * record silently contradicting itself.
 */
import { ROLE_GROUPS, type RoleGroupKey } from "@/lib/roleGroups";

const KEYS: ReadonlySet<string> = new Set(ROLE_GROUPS.map((g) => g.key));

/** The stored value as a RoleGroupKey, or null for null/blank/legacy garbage. */
function knownKey(stored: string | null): RoleGroupKey | null {
  const key = stored?.trim();
  return key && KEYS.has(key) ? (key as RoleGroupKey) : null;
}

/** Label for a stored group; anything outside the closed set renders as the placeholder, never a raw key. */
export function roleGroupDisplay(
  stored: string | null,
  labels: Readonly<Record<RoleGroupKey, string>>,
  emptyValue: string,
): string {
  const key = knownKey(stored);
  return key ? labels[key] : emptyValue;
}

export function roleGroupRowView(
  stored: string | null,
  derived: RoleGroupKey,
  labels: Readonly<Record<RoleGroupKey, string>>,
  emptyValue: string,
  plainHint: string,
  driftHint: (storedLabel: string | null, derivedLabel: string) => string,
): { text: string; hint: string } {
  const key = knownKey(stored);
  return {
    text: roleGroupDisplay(stored, labels, emptyValue),
    hint: key === derived ? plainHint : driftHint(key ? labels[key] : null, labels[derived]),
  };
}
