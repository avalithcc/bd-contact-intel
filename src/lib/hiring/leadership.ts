import type { RoleGroupKey } from "@/lib/roleGroups";

// Role groups treated as "leadership/decision-maker for engineering
// capacity" — used to rank/prioritize hiring contacts most worth reaching
// out to at a company that's actively hiring. Split into its own DB-free
// module (rather than living directly in hiring/queries.ts, which imports
// `db`) so pure builders/tests can depend on just the constant — see
// src/lib/outreach/personMessageInput.ts.
export const LEADERSHIP_ROLE_GROUPS: RoleGroupKey[] = [
  "c_level_tech",
  "c_level_business",
  "eng_leadership",
  "engineering_manager",
];
