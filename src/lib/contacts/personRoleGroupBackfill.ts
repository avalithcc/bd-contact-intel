import { classifyPosition } from "@/lib/roleGroups";

export const NULL_GROUP_LABEL = "(null)";

export interface PersonRoleGroupRow {
  id: string;
  jobTitle: string | null;
  roleGroup: string | null;
}

export interface RoleGroupTally {
  before: Record<string, number>;
  after: Record<string, number>;
  /** "from -> to" for rows whose group changes; unchanged rows are not counted. */
  transitions: Record<string, number>;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

/**
 * Computes the new role group for a page of persons, accumulating counts into
 * `tally` (the only thing mutated) and returning just the rows to update.
 * The rows themselves are never modified.
 */
export function planRoleGroupPage(
  rows: readonly PersonRoleGroupRow[],
  tally: RoleGroupTally,
): { id: string; roleGroup: string }[] {
  const changes: { id: string; roleGroup: string }[] = [];
  for (const row of rows) {
    const next = classifyPosition(row.jobTitle);
    const current = row.roleGroup ?? NULL_GROUP_LABEL;
    bump(tally.before, current);
    bump(tally.after, next);
    if (row.roleGroup !== next) {
      bump(tally.transitions, `${current} -> ${next}`);
      changes.push({ id: row.id, roleGroup: next });
    }
  }
  return changes;
}

function sortedEntries(map: Record<string, number>): [string, number][] {
  return Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function summarizeTally(tally: RoleGroupTally) {
  return {
    before: sortedEntries(tally.before).map(([group, count]) => ({ group, count })),
    after: sortedEntries(tally.after).map(([group, count]) => ({ group, count })),
    transitions: sortedEntries(tally.transitions).map(([transition, count]) => ({ transition, count })),
  };
}
