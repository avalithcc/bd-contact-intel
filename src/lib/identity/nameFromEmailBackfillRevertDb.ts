/**
 * Thin DB layer for scripts/backfill-person-names-from-email.ts's --revert
 * mode. All real logic lives in nameFromEmailBackfillRevert.ts (pure,
 * unit-tested); this file only touches the database.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, duplicateCandidate, person } from "@/db/schema";
import type { AppliedNameFromEmailFill, QueuedDuplicateCandidateRef } from "@/lib/identity/nameFromEmailBackfillAudit";
import type { CurrentDuplicateCandidateState, CurrentPersonNameState } from "@/lib/identity/nameFromEmailBackfillRevert";

const BACKFILL_ACTION = "person_name_from_email_backfill";

export interface NameFromEmailBackfillAuditRow {
  id: string;
  fills: AppliedNameFromEmailFill[];
  duplicateCandidatesQueued: QueuedDuplicateCandidateRef[];
}

/**
 * The most recent `audit_log` row for this backfill's `--execute` action —
 * one indexed query (audit_log has no dedicated index on `action`, but this
 * table is small and admin-only; bounded by `LIMIT 1`). Returns null when
 * this backfill has never been executed.
 */
export async function readLatestNameFromEmailBackfillAudit(): Promise<NameFromEmailBackfillAuditRow | null> {
  const [row] = await db
    .select({ id: auditLog.id, metadata: auditLog.metadata })
    .from(auditLog)
    .where(eq(auditLog.action, BACKFILL_ACTION))
    .orderBy(desc(auditLog.at))
    .limit(1);
  if (!row) return null;
  const metadata = row.metadata as {
    fills?: AppliedNameFromEmailFill[];
    duplicateCandidatesQueued?: QueuedDuplicateCandidateRef[];
  };
  return {
    id: row.id,
    fills: metadata.fills ?? [],
    duplicateCandidatesQueued: metadata.duplicateCandidatesQueued ?? [],
  };
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
