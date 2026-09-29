/**
 * Thin DB layer for scripts/backfill-split-stuffed-names.ts's --revert mode.
 * All real logic lives in stuffedNameSplitBackfillRevert.ts (pure,
 * unit-tested); this file only touches the database.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, person } from "@/db/schema";
import type { CurrentPersonNameState, StuffedNameSplitAuditRowForSelection } from "@/lib/identity/stuffedNameSplitBackfillRevert";

export const STUFFED_NAME_SPLIT_BACKFILL_ACTION = "person_stuffed_name_split_backfill";
export const STUFFED_NAME_SPLIT_REVERT_ACTION = "person_stuffed_name_split_backfill_revert";

/**
 * EVERY `audit_log` row for this backfill's `--execute` action — CRITICAL:
 * revert must never just read the MOST RECENT row (see
 * stuffedNameSplitBackfillRevert.ts#selectStuffedNameSplitAuditRow for the
 * read-side selection rule this feeds). Small, admin-only table — one row
 * per backfill run — so no LIMIT needed.
 */
export async function readAllStuffedNameSplitAuditRows(): Promise<StuffedNameSplitAuditRowForSelection[]> {
  const rows = await db
    .select({ id: auditLog.id, at: auditLog.at, actorBdId: auditLog.actorBdId, metadata: auditLog.metadata })
    .from(auditLog)
    .where(eq(auditLog.action, STUFFED_NAME_SPLIT_BACKFILL_ACTION))
    .orderBy(desc(auditLog.at));

  return rows.map((row) => {
    const metadata = row.metadata as { fills?: StuffedNameSplitAuditRowForSelection["fills"] };
    return { id: row.id, at: row.at, actorBdId: row.actorBdId, fills: metadata.fills ?? [] };
  });
}

/** Current first_name/last_name for exactly the audited person ids — never
 * the whole `person` table. Empty input returns empty output. */
export async function readCurrentPersonsByIds(ids: readonly string[]): Promise<CurrentPersonNameState[]> {
  if (ids.length === 0) return [];
  return db
    .select({ id: person.id, firstName: person.firstName, lastName: person.lastName })
    .from(person)
    .where(inArray(person.id, [...ids]));
}
