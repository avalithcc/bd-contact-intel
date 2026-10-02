import { classifyPosition } from "@/lib/roleGroups";

export const NULL_GROUP_LABEL = "(null)";

export interface PersonRoleGroupRow {
  id: string;
  jobTitle: string | null;
  roleGroup: string | null;
  /** A BD corrected this group by hand (person_property_history source 'edit'). */
  humanEdited?: boolean;
  ownerBdId?: string | null;
  contactType?: string | null;
}

export interface RoleGroupChange {
  id: string;
  /** Stored group before the change; null when it was never classified. */
  from: string | null;
  roleGroup: string;
  ownerBdId: string | null;
  contactType: string | null;
}

export interface RoleGroupTally {
  before: Record<string, number>;
  after: Record<string, number>;
  /** "from -> to" for rows whose group changes; unchanged rows are not counted. */
  transitions: Record<string, number>;
  /** Rows left untouched because a human edited their role group. */
  skippedHumanEdits: number;
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
): RoleGroupChange[] {
  const changes: RoleGroupChange[] = [];
  for (const row of rows) {
    const current = row.roleGroup ?? NULL_GROUP_LABEL;
    bump(tally.before, current);
    if (row.humanEdited) {
      tally.skippedHumanEdits += 1;
      bump(tally.after, current);
      continue;
    }
    const next = classifyPosition(row.jobTitle);
    bump(tally.after, next);
    if (row.roleGroup !== next) {
      bump(tally.transitions, `${current} -> ${next}`);
      changes.push({
        id: row.id,
        from: row.roleGroup,
        roleGroup: next,
        ownerBdId: row.ownerBdId ?? null,
        contactType: row.contactType ?? null,
      });
    }
  }
  return changes;
}

function sortedEntries(map: Record<string, number>): [string, number][] {
  return Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function summarizeTally(tally: RoleGroupTally) {
  const nullClassified = Object.entries(tally.transitions)
    .filter(([k]) => k.startsWith(`${NULL_GROUP_LABEL} -> `))
    .reduce((sum, [, n]) => sum + n, 0);
  return {
    nullClassified,
    skippedHumanEdits: tally.skippedHumanEdits,
    before: sortedEntries(tally.before).map(([group, count]) => ({ group, count })),
    after: sortedEntries(tally.after).map(([group, count]) => ({ group, count })),
    transitions: sortedEntries(tally.transitions).map(([transition, count]) => ({ transition, count })),
  };
}
