/**
 * Thin DB layer for scripts/backfill-split-remaining-stuffed-names.ts's
 * --revert mode. The revert SELECTION logic
 * (buildStuffedNameSplitRevertPlan / selectStuffedNameSplitAuditRow) and the
 * current-persons reader (readCurrentPersonsByIds) are fully generic — keyed
 * only by personId/firstName/lastName/originalFirstName/originalLastName,
 * with no dependency on which rule produced a fill — so this module REUSES
 * them from stuffedNameSplitBackfillRevert.ts /
 * stuffedNameSplitBackfillRevertDb.ts rather than duplicating them. Only the
 * audit_log action name differs, so only the action-scoped row reader is new
 * here, keeping this backfill's audit trail independently revertible from
 * PR #186's.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import type { StuffedNameSplitAuditRowForSelection } from "@/lib/identity/stuffedNameSplitBackfillRevert";

export const FIRST_TOKEN_SPLIT_BACKFILL_ACTION = "person_first_token_split_backfill";
export const FIRST_TOKEN_SPLIT_REVERT_ACTION = "person_first_token_split_backfill_revert";

/**
 * EVERY `audit_log` row for this backfill's `--execute` action — CRITICAL:
 * revert must never just read the MOST RECENT row (see
 * stuffedNameSplitBackfillRevert.ts#selectStuffedNameSplitAuditRow for the
 * read-side selection rule this feeds). Small, admin-only table — one row
 * per backfill run — so no LIMIT needed.
 */
export async function readAllFirstTokenSplitAuditRows(): Promise<StuffedNameSplitAuditRowForSelection[]> {
  const rows = await db
    .select({ id: auditLog.id, at: auditLog.at, actorBdId: auditLog.actorBdId, metadata: auditLog.metadata })
    .from(auditLog)
    .where(eq(auditLog.action, FIRST_TOKEN_SPLIT_BACKFILL_ACTION))
    .orderBy(desc(auditLog.at));

  return rows.map((row) => {
    const metadata = row.metadata as { fills?: StuffedNameSplitAuditRowForSelection["fills"] };
    return { id: row.id, at: row.at, actorBdId: row.actorBdId, fills: metadata.fills ?? [] };
  });
}
