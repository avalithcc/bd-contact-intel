/**
 * Audit decision for an admin reading another BD's Sequence (sequence-roster "Admin read of another BD's drafts is
 * audited"). Kept as its own pure module so the policy is ONE line.
 *
 * OWNER NOTE: the owner has a pending preference in the other direction for a different surface (admins read a
 * Contact's conversations inline, no audit row; see openspec/BACKLOG.md). If he extends it to Sequences, change the
 * `return` below to `false` (or delete the call in detailQueries.ts); nothing else depends on it.
 */
import type { NewAuditLog } from "@/db/schema";

export const SEQUENCE_READ_AUDIT_ACTION = "view_sequence";

export function shouldAuditSequenceRead(actorBdId: string, ownerBdId: string): boolean {
  return actorBdId !== ownerBdId;
}

/** Actor, owner BD and timestamp (`at` defaults to now in the table); the Sequence id rides in metadata. */
export function sequenceReadAuditRow(actorBdId: string, ownerBdId: string, sequenceId: string): NewAuditLog {
  return { action: SEQUENCE_READ_AUDIT_ACTION, actorBdId, targetBdId: ownerBdId, metadata: { sequenceId } };
}
