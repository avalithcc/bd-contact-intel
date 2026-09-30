/**
 * "Ocultar grupos No priorizar por defecto" (owner decision 2026-09-30,
 * "opción A"): `/contacts` hides person rows whose `role_group` is one the
 * BD playbook (roleGroupPlaybook.ts) marks "no_priorizar" — reversibly,
 * never deleting data. `NOT_WORTH_PRIORITIZING.noPriorizar.keys` is the
 * single source of truth for WHICH groups those are (the same list the
 * "Por qué estos grupos" disclosure already reads, FilterMenu.tsx) — if the
 * guide changes, this default changes with it, no separate list to drift.
 *
 * Both halves are pure (no `@/db`, no live DATABASE_URL needed — same
 * convention as src/lib/shell/appShellBadgeCountsQuery.ts):
 * `resolveRoleVisibility` decides WHICH keys a given request should hide;
 * `roleGroupVisibilityCondition` turns that list into the WHERE condition.
 * listQueries.ts/page.tsx/export/route.ts each resolve this ONCE per
 * request and thread the result through every read (page query, count
 * query, view-tab badges, CSV export), so none of them can disagree on
 * which rows are hidden.
 */
import { isNull, notInArray, or, type SQL } from "drizzle-orm";
import { person } from "@/db/schema";
import { NOT_WORTH_PRIORITIZING } from "@/lib/roleGroupPlaybook";
import type { RoleGroupKey } from "@/lib/roleGroups";

/** The only escape hatch (`?roles=all`) — a stable, bookmarkable URL value
 * (task brief: "reloads and shared links are stable"). Any other value
 * (absent, or unrecognized) falls back to the hidden default rather than
 * throwing, since this reads directly off a user-controlled query param. */
export const SHOW_ALL_ROLES_PARAM_VALUE = "all";

export interface RoleVisibility {
  /** Role-group keys this request's reads must exclude — empty when the
   * default is overridden. */
  hiddenRoleGroups: RoleGroupKey[];
  /** Whether the default exclusion is ACTIVE for this request — drives the
   * "Ocultos: ..." chip. Currently always `hiddenRoleGroups.length > 0`,
   * kept as its own field so a future "hide a smaller/different set" tweak
   * can't silently change the chip's condition too. */
  isDefaultActive: boolean;
}

/**
 * `explicitRoleGroup` is the ad-hoc `roleGroup` filter a BD picked from
 * "Agregar filtro" (viewFilters.ts `ContactFilters.roleGroup`) — picking a
 * SPECIFIC group is always an explicit choice to see it, so it overrides the
 * default hide even when that very group is "No priorizar" (task brief:
 * "Any explicit role-group filter the user picks overrides the default").
 * An empty string (the ad-hoc "cleared" sentinel — viewFilters.ts) is not a
 * selection and does NOT override.
 */
export function resolveRoleVisibility(
  rolesParam: string | undefined,
  explicitRoleGroup: string | undefined,
): RoleVisibility {
  const overridden = rolesParam === SHOW_ALL_ROLES_PARAM_VALUE || !!explicitRoleGroup;
  const hiddenRoleGroups = overridden ? [] : [...NOT_WORTH_PRIORITIZING.noPriorizar.keys];
  return { hiddenRoleGroups, isDefaultActive: hiddenRoleGroups.length > 0 };
}

/**
 * `role_group NOT IN (...)` alone silently drops every NULL row too — SQL's
 * classic `NOT IN` + NULL trap: `NULL NOT IN (...)` evaluates to NULL, which
 * a WHERE clause treats as false. Task brief: "null or unknown role groups
 * stay VISIBLE" — the explicit `IS NULL` branch guards that instead of
 * relying on it.
 */
export function roleGroupVisibilityCondition(hiddenRoleGroups: readonly RoleGroupKey[]): SQL | undefined {
  if (!hiddenRoleGroups.length) return undefined;
  return or(isNull(person.roleGroup), notInArray(person.roleGroup, [...hiddenRoleGroups]));
}
