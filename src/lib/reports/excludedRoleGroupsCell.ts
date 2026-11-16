/**
 * The "Roles excluidos" cell of the queue-adherence table (admin-role-group-visibility; mockup
 * reportes-roles-excluidos.html). Read-only: admins see what each BD keeps out of their own follow-up queue, because
 * the adherence % beside it cannot be read without that — a BD who excludes groups works a DIFFERENT queue, not the
 * same queue harder. Nothing here writes, and admins do not change another BD's preference.
 *
 * Pure on purpose: the page renders what this returns, and the tests check this, so what is tested is what ships.
 */
import { ROLE_GROUPS, type RoleGroupKey } from "@/lib/roleGroups";

export interface ExcludedRoleGroupsCell {
  /** The badges to render, at most `maxShown`, in ROLE_GROUPS display order. */
  shown: string[];
  /** How many more are excluded beyond `shown`; 0 when everything fits. */
  overflow: number;
  /** The complete list, for the cell's `title` — the overflow is only reachable on hover. */
  title: string;
  /** No exclusions at all: the cell renders a dash. */
  empty: boolean;
}

/**
 * `excluded` is whatever is stored on `bd.follow_up_excluded_role_groups`. It is re-ordered here into ROLE_GROUPS
 * display order rather than trusting the stored order, so two BDs with the same exclusions always read identically.
 *
 * A stored key that is no longer a `RoleGroupKey` (a group dropped from the code after someone excluded it) is kept
 * and shown as its raw key, LAST. Dropping it would quietly understate what that BD is excluding, and a wrong number
 * in an admin report is worse than an ugly one.
 */
export function excludedRoleGroupsCell(
  excluded: readonly string[],
  roleGroupLabels: Record<RoleGroupKey, string>,
  maxShown = 2,
): ExcludedRoleGroupsCell {
  const unique = [...new Set(excluded)];
  const known = ROLE_GROUPS.filter((g) => unique.includes(g.key)).map((g) => roleGroupLabels[g.key]);
  const knownKeys = new Set<string>(ROLE_GROUPS.map((g) => g.key));
  const unknown = unique.filter((k) => !knownKeys.has(k));
  const all = [...known, ...unknown];

  return {
    shown: all.slice(0, maxShown),
    overflow: Math.max(0, all.length - maxShown),
    title: all.join(", "),
    empty: all.length === 0,
  };
}
