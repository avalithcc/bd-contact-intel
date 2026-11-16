/**
 * Pure half of the per-BD follow-up role-group preference (follow-up-role-groups): validation of what a BD submits and the
 * mapper for the panel's per-group counts. No `@/db` import, so it is unit-testable without a DATABASE_URL.
 */
import { ROLE_GROUPS, type RoleGroupKey } from "@/lib/roleGroups";
import { ROLE_GROUP_COUNT_COLUMNS } from "@/lib/followUp/candidateQuery";

export type ParseExcludedRoleGroupsResult =
  | { ok: true; groups: RoleGroupKey[] }
  | { ok: false; error: "invalid" | "unknown_group" | "all_excluded" };

const ROLE_GROUP_KEYS: readonly string[] = ROLE_GROUPS.map((g) => g.key);

/**
 * Validates a submitted deny-list against `RoleGroupKey` (the one key list, roleGroups.ts). Unknown keys are rejected, not dropped,
 * and so is excluding every group: an empty queue by configuration is a support ticket, not a feature. Returns a new array, once per
 * key, in display order; never mutates the input.
 */
export function parseExcludedRoleGroups(input: unknown): ParseExcludedRoleGroupsResult {
  if (!Array.isArray(input) || input.some((v) => typeof v !== "string")) return { ok: false, error: "invalid" };
  if (input.some((v: string) => !ROLE_GROUP_KEYS.includes(v))) return { ok: false, error: "unknown_group" };
  const chosen = new Set<string>(input);
  if (chosen.size === ROLE_GROUP_KEYS.length) return { ok: false, error: "all_excluded" };
  return { ok: true, groups: ROLE_GROUPS.map((g) => g.key).filter((k) => chosen.has(k)) };
}

/** Due contacts the saved deny-list keeps out of the rotation: the sum of the excluded groups' counts. */
export function roleGroupLeftOutCount(counts: Record<RoleGroupKey, number>, excluded: readonly string[]): number {
  return excluded.reduce((sum, key) => sum + (counts[key as RoleGroupKey] ?? 0), 0);
}

type CountRow = { [ROLE_GROUP_COUNT_COLUMNS.group]: string | null; [ROLE_GROUP_COUNT_COLUMNS.count]: number | string };

/** Every group, zero when the query returned no row for it; counts normalized to numbers (raw `sql` aggregates can arrive as strings). */
export function roleGroupCountsFromRows(rows: readonly CountRow[]): Record<RoleGroupKey, number> {
  const counts = Object.fromEntries(ROLE_GROUPS.map((g) => [g.key, 0])) as Record<RoleGroupKey, number>;
  for (const row of rows) {
    const key = row[ROLE_GROUP_COUNT_COLUMNS.group];
    if (key !== null && ROLE_GROUP_KEYS.includes(key)) counts[key as RoleGroupKey] = Number(row[ROLE_GROUP_COUNT_COLUMNS.count]);
  }
  return counts;
}
