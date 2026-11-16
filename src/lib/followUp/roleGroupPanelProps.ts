/**
 * The exact props `/follow-ups` hands to `RoleGroupsPanel` / `ExcludedRoleGroupChips`, built here rather than inline in
 * the page so a test can check the REAL producer instead of a hand-built copy that is free to drift from it.
 *
 * Why this module exists at all: these objects cross the server/client boundary, so every value in them must be
 * serializable. The first version of this feature put two dictionary FUNCTIONS (`rolesChipRemoveAria`,
 * `rolesLeftOutMeta`) straight into the labels object, and every render of `/follow-ups` threw "An error occurred in
 * the Server Components render" in production. `next build` does not catch it and no test rendered the page.
 *
 * The fix is structural, not a convention to remember: `RoleGroupPanelCopy` and `RoleGroupsLabels` below declare every
 * entry as `string`, so handing a function to either one is a COMPILE error at the call site. Placeholder strings
 * (`{label}`, `{n}`) are filled on the client with `fillTemplate` — the rule src/lib/i18n/template.ts already states.
 */
import { ROLE_GROUPS, type RoleGroupKey } from "@/lib/roleGroups";
import { PRIORITY_BADGE_CLASS, ROLE_GROUP_PLAYBOOK } from "@/lib/roleGroupPlaybook";

export interface RoleGroupRow {
  key: string;
  label: string;
  priorityClass: string;
  priorityLabel: string;
}

export interface RoleGroupsLabels {
  trigger: string;
  heading: string;
  intro: string;
  guideLink: string;
  reset: string;
  save: string;
  saving: string;
  saveError: string;
  chipKey: string;
  /** Carries a `{label}` placeholder, filled on the client. Never a function: see this file's header. */
  chipRemoveAria: string;
  /** Success toast after a save: the change applies from the next daily build, so nothing visibly moves today. */
  savedToast: string;
  /** Carries an `{n}` placeholder, filled on the client. Never a function: see this file's header. */
  leftOutMeta: string;
  countsLoading: string;
}

/** The `followUpsPage` dictionary slice this panel reads. Every member is `string` ON PURPOSE — that is the guard. */
export interface RoleGroupPanelCopy {
  rolesTrigger: string;
  rolesHeading: string;
  rolesIntro: string;
  rolesGuideLink: string;
  rolesReset: string;
  rolesSave: string;
  rolesSaving: string;
  rolesSaveError: string;
  rolesChipKey: string;
  rolesChipRemoveAria: string;
  rolesSavedToast: string;
  rolesLeftOutMeta: string;
  rolesCountsLoading: string;
}

/** One row per role group, in display order, with its playbook priority badge. */
export function roleGroupPanelRows(roleGroupLabels: Record<RoleGroupKey, string>): RoleGroupRow[] {
  return ROLE_GROUPS.map(({ key }) => ({
    key,
    label: roleGroupLabels[key],
    priorityClass: PRIORITY_BADGE_CLASS[ROLE_GROUP_PLAYBOOK[key].priority],
    priorityLabel: ROLE_GROUP_PLAYBOOK[key].priorityLabel,
  }));
}

export function roleGroupPanelLabels(l: RoleGroupPanelCopy): RoleGroupsLabels {
  return {
    trigger: l.rolesTrigger,
    heading: l.rolesHeading,
    intro: l.rolesIntro,
    guideLink: l.rolesGuideLink,
    reset: l.rolesReset,
    save: l.rolesSave,
    saving: l.rolesSaving,
    saveError: l.rolesSaveError,
    chipKey: l.rolesChipKey,
    chipRemoveAria: l.rolesChipRemoveAria,
    savedToast: l.rolesSavedToast,
    leftOutMeta: l.rolesLeftOutMeta,
    countsLoading: l.rolesCountsLoading,
  };
}
