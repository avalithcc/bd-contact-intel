import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bd } from "@/db/schema";
import { buildFollowUpRoleGroupCountsQuery, ROLE_GROUP_COUNT_COLUMNS } from "@/lib/followUp/candidateQuery";
import { roleGroupCountsFromRows } from "@/lib/followUp/roleGroupPreference";
import type { RoleGroupKey } from "@/lib/roleGroups";

/** One aggregate round trip: the BD's own due contacts per role group, every group present (zero when none). */
export async function getFollowUpRoleGroupCounts(bdId: string): Promise<Record<RoleGroupKey, number>> {
  const rows = (await db.execute(buildFollowUpRoleGroupCountsQuery(bdId))) as unknown as {
    [ROLE_GROUP_COUNT_COLUMNS.group]: string | null;
    [ROLE_GROUP_COUNT_COLUMNS.count]: number | string;
  }[];
  return roleGroupCountsFromRows(rows);
}

/**
 * Stores the signed-in BD's own deny-list (already validated by `parseExcludedRoleGroups`). The WHERE is the actor's own id, so a BD
 * can only write their own preference. One statement, so nothing partial exists; no audit_log row on purpose (a queue preference is
 * not a consequential action). Revert: save an empty list, or `update bd set follow_up_excluded_role_groups = '{}'`.
 */
export async function saveOwnExcludedRoleGroups(bdId: string, groups: RoleGroupKey[]): Promise<void> {
  await db.update(bd).set({ followUpExcludedRoleGroups: groups }).where(eq(bd.id, bdId));
}
