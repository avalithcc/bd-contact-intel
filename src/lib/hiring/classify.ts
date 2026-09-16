import { classifyPosition, type RoleGroupKey } from "@/lib/roleGroups";

/**
 * Role groups (see src/lib/roleGroups.ts) treated as "IT hiring" signals
 * when found in a job posting's title. Reuses the same classifier already
 * used for contacts — no second classifier is maintained.
 *
 * Deliberately limited to the clearly technical groups: c_level_tech,
 * eng_leadership, engineering_manager, tech_lead_architect, developers.
 * `product` and `project_delivery` are excluded by default — they're only
 * sometimes IT-adjacent and would add noisy false positives to "open IT
 * roles"; revisit if that turns out to matter in practice.
 */
export const IT_ROLE_GROUPS: readonly RoleGroupKey[] = [
  "c_level_tech",
  "eng_leadership",
  "engineering_manager",
  "tech_lead_architect",
  "developers",
];

const IT_ROLE_GROUP_SET = new Set<RoleGroupKey>(IT_ROLE_GROUPS);

/** Whether a job posting title classifies into one of IT_ROLE_GROUPS. */
export function isItPosting(title: string): boolean {
  return IT_ROLE_GROUP_SET.has(classifyPosition(title));
}
