/**
 * The role-group badge text for a follow-up queue card, or null when there should be no badge.
 *
 * `person.role_group` is free-form in the database: it holds a `RoleGroupKey` today, but a row written before the
 * taxonomy existed, or by an import, can hold anything. A key with no label would render an empty badge, which says
 * less than no badge at all, so an unknown value produces null rather than a blank chip or a raw key.
 */
import { ROLE_GROUPS, type RoleGroupKey } from "@/lib/roleGroups";

const KNOWN = new Set<string>(ROLE_GROUPS.map((g) => g.key));

export function roleGroupLabel(roleGroup: string | null, labels: Record<RoleGroupKey, string>): string | null {
  if (!roleGroup || !KNOWN.has(roleGroup)) return null;
  return labels[roleGroup as RoleGroupKey] || null;
}
