/**
 * Thin DB layer for scripts/backfill-person-names-from-email.ts's --revert
 * mode. All real logic lives in nameFromEmailBackfillRevert.ts (pure,
 * unit-tested); this file only touches the database.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, duplicateCandidate, person } from "@/db/schema";
import type { NameFromEmailBackfillAuditRowForSelection } from "@/lib/identity/nameFromEmailBackfillRevert";
import type { CurrentDuplicateCandidateState, CurrentPersonNameState } from "@/lib/identity/nameFromEmailBackfillRevert";

const BACKFILL_ACTION = "person_name_from_email_backfill";

/**
 * EVERY `audit_log` row for this backfill's `--execute` action, oldest to
 * newest metadata shape aside — CRITICAL: revert must never just read the
 * MOST RECENT row (a no-op re-run used to still write an empty one, which
 * would then hide the real backfill run from revert — see
 * nameFromEmailBackfillAudit.ts#isNameFromEmailBackfillAuditWorthRecording
 * for the write-side fix, and
 * nameFromEmailBackfillRevert.ts#selectNameFromEmailBackfillAuditRow for the
 * read-side selection rule this feeds). This table is small and admin-only
 * (one row per backfill run, never per-person), so reading every matching
 * row is bounded and cheap — no LIMIT needed.
 */
export async function readAllNameFromEmailBackfillAuditRows(): Promise<NameFromEmailBackfillAuditRowForSelection[]> {
  const rows = await db
    .select({ id: auditLog.id, at: auditLog.at, actorBdId: auditLog.actorBdId, metadata: auditLog.metadata })
    .from(auditLog)
    .where(eq(auditLog.action, BACKFILL_ACTION))
    .orderBy(desc(auditLog.at));

  return rows.map((row) => {
    const metadata = row.metadata as {
      fills?: NameFromEmailBackfillAuditRowForSelection["fills"];
      duplicateCandidatesQueued?: NameFromEmailBackfillAuditRowForSelection["duplicateCandidatesQueued"];
    };
    return {
      id: row.id,
      at: row.at,
      actorBdId: row.actorBdId,
      fills: metadata.fills ?? [],
      duplicateCandidatesQueued: metadata.duplicateCandidatesQueued ?? [],
    };
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

/** Current status for exactly the audited duplicate_candidate ids. Empty
 * input returns empty output. */
export async function readCurrentDuplicateCandidatesByIds(
  ids: readonly string[],
): Promise<CurrentDuplicateCandidateState[]> {
  if (ids.length === 0) return [];
  return db
    .select({ id: duplicateCandidate.id, status: duplicateCandidate.status })
    .from(duplicateCandidate)
    .where(inArray(duplicateCandidate.id, [...ids]));
}

export { BACKFILL_ACTION };
export const REVERT_ACTION = "person_name_from_email_backfill_revert";
