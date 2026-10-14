/**
 * DB side of the person-merge policy for Sequence memberships (see mergePlan.ts for the rules). Takes a transaction;
 * `db` is a type-only import so mergeDb.ts stays loadable without DATABASE_URL.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { sequence, sequenceDraft, sequenceMember } from "@/db/schema";
import { planSequenceMerge, type MergeMembership, type SequenceMergePlan } from "./mergePlan";

type Database = typeof db;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const MERGE_DUPLICATE_DISCARD_REASON = "merge_duplicate";

/** Thrown to stop a merge: carries the plan so the caller can name every affected membership. */
export class SequenceMergeBlockedError extends Error {
  constructor(readonly plan: SequenceMergePlan) {
    super(
      plan.blockers.length
        ? `Merge blocked by Sequence memberships: ${plan.blockers.join(", ")}`
        : "Merge needs acknowledgement of affected Sequence memberships",
    );
    this.name = "SequenceMergeBlockedError";
  }
}

export async function planSequenceMergeFor(
  reader: Pick<Database, "select">,
  survivorId: string,
  mergedId: string,
): Promise<SequenceMergePlan> {
  // Draft facts come from correlated subqueries (one round trip). Raw-SQL timestamps are normalised to Date.
  const rawRows = await reader
    .select({
      memberId: sequenceMember.id,
      personId: sequenceMember.personId,
      sequenceId: sequenceMember.sequenceId,
      sequenceName: sequence.name,
      state: sequenceMember.state,
      sentAt: sequenceMember.sentAt,
      handEdited: sql<boolean>`exists (select 1 from sequence_draft d where d.sequence_member_id = ${sequenceMember.id} and d.edited_at is not null)`,
      scheduledFor: sql<string | Date | null>`(select min(d.scheduled_for) from sequence_draft d where d.sequence_member_id = ${sequenceMember.id} and d.approved_at is not null)`,
    })
    .from(sequenceMember)
    .innerJoin(sequence, eq(sequence.id, sequenceMember.sequenceId))
    .where(inArray(sequenceMember.personId, [survivorId, mergedId]));
  const rows: MergeMembership[] = rawRows.map((r) => ({
    ...r,
    handEdited: Boolean(r.handEdited),
    scheduledFor: r.scheduledFor ? new Date(r.scheduledFor) : null,
  }));
  return planSequenceMerge(survivorId, mergedId, rows);
}

/**
 * Runs inside mergeContacts' transaction. No memberships: a no-op. Otherwise throws unless the BD acknowledged the
 * warning AND nothing blocks (a scheduled send, or a send-history collision). Rows are never deleted unless the plan
 * says a drafted/discarded loser can go; sent/replied/no_reply members are only ever repointed.
 */
export async function applySequenceMerge(
  tx: Tx,
  survivorId: string,
  mergedId: string,
  actorBdId: string,
  acknowledged: boolean,
): Promise<void> {
  await tx.select({ id: sequenceMember.id }).from(sequenceMember).where(inArray(sequenceMember.personId, [survivorId, mergedId])).for("update");
  const plan = await planSequenceMergeFor(tx, survivorId, mergedId);
  if (!plan.affected.length) return;
  if (plan.blockers.length || !acknowledged) throw new SequenceMergeBlockedError(plan);
  if (plan.deleteMembers.length) await tx.delete(sequenceMember).where(inArray(sequenceMember.id, plan.deleteMembers));
  if (plan.discard.length) {
    await tx
      .update(sequenceMember)
      .set({ state: "discarded", discardReason: MERGE_DUPLICATE_DISCARD_REASON, discardedByBdId: actorBdId, discardedAt: new Date() })
      .where(inArray(sequenceMember.id, plan.discard));
  }
  if (plan.repoint.length) await tx.update(sequenceMember).set({ personId: survivorId }).where(inArray(sequenceMember.id, plan.repoint));
}

/** "Cancelar envio" from the merge warning: approved -> drafted, approval cleared. False if it was not approved. */
export async function cancelScheduledSend(database: Database, memberId: string): Promise<boolean> {
  return database.transaction(async (tx) => {
    const [row] = await tx.select({ state: sequenceMember.state }).from(sequenceMember).where(eq(sequenceMember.id, memberId)).for("update");
    if (!row || row.state !== "approved") return false;
    await tx.update(sequenceMember).set({ state: "drafted" }).where(and(eq(sequenceMember.id, memberId), eq(sequenceMember.state, "approved")));
    await tx
      .update(sequenceDraft)
      .set({ approvedAt: null, approvedByBdId: null, scheduledFor: null })
      .where(eq(sequenceDraft.sequenceMemberId, memberId));
    return true;
  });
}
