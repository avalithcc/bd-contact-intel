/**
 * DB ports for applyReplies.ts. Imports `@/db`, so like the other *Queries modules it is covered by the DB tests
 * (tests/db/sequenceReplies.test.ts), not the unit layer. Two statements of reads and writes per sync batch at most:
 * one read of the Contacts' sent members, then one transaction for the move and the reminder withdrawal. Cross-BD and
 * actor-less by design: see applyReplies.ts.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { sequenceDraft, sequenceMember } from "@/db/schema";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";
import type { ReplyMember, ReplyPorts, ReplyUpdate } from "./applyReplies";

const REMINDER_STEP = 2;

/** Uses sequence_member_person_idx. Only members that have been sent to can reply, so drafted/approved rows never load. */
export async function findSentMembers(personIds: readonly string[]): Promise<ReplyMember[]> {
  const out: ReplyMember[] = [];
  for (const part of chunk(personIds, WRITE_BATCH_SIZE)) {
    out.push(
      ...(await db
        .select({ id: sequenceMember.id, personId: sequenceMember.personId, state: sequenceMember.state, sentAt: sequenceMember.sentAt })
        .from(sequenceMember)
        .where(and(inArray(sequenceMember.personId, part), inArray(sequenceMember.state, ["sent", "no_reply"]), isNotNull(sequenceMember.sentAt)))),
    );
  }
  return out;
}

/** A row-lock wait must not eat the sync's remaining budget (the hook is best-effort, the sync is not). */
export const REPLY_LOCK_TIMEOUT = "5s";

/**
 * All or nothing. The state guard is in the statement (a stale plan, or a member another run already moved, matches
 * nothing), `sent_at < replied_at` is re-checked there, and only members that actually moved lose their reminder. A
 * reminder is withdrawn by clearing its due date (pending) and its approval (approved); the draft text stays as history.
 * An in-flight step 2 claim is deliberately untouched: it is the send path's to settle. `lock_timeout` makes a blocked
 * row fail fast; the caller (withSequenceReplies) swallows that, and the runner's own check reads email_message directly.
 * No audit row and no actor: see applyReplies.ts.
 * Revert path (a misread reply): every member this wrote has replied_at set and nothing else writes that column. Set such
 * a member back to 'no_reply' if it has a step 2 claim with outcome 'sent', else to 'sent', clear replied_at, and
 * re-derive reminder_due_at from sent_at (schedule.ts reminderDueAt). Withdrawn approvals are re-approved by hand.
 */
export async function applyReplyUpdates(updates: readonly ReplyUpdate[]): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local lock_timeout = '${REPLY_LOCK_TIMEOUT}'`));
    let moved = 0;
    for (const part of chunk(updates, WRITE_BATCH_SIZE)) {
      const values = sql.join(part.map((u) => sql`(${u.memberId}::uuid, ${u.repliedAt.toISOString()}::timestamptz)`), sql`, `);
      const rows = (await tx.execute(sql`
        update sequence_member sm
        set state = 'replied', replied_at = v.rp_at, reminder_due_at = null, hold_reason = null, hold_at = null
        from (values ${values}) as v(rp_id, rp_at)
        where sm.id = v.rp_id and sm.state in ('sent', 'no_reply') and sm.sent_at < v.rp_at
        returning sm.id::text as id`)) as unknown as { id: string }[];
      if (rows.length === 0) continue;
      moved += rows.length;
      await tx
        .update(sequenceDraft)
        .set({ approvedAt: null, approvedByBdId: null, scheduledFor: null })
        .where(and(inArray(sequenceDraft.sequenceMemberId, rows.map((r) => r.id)), eq(sequenceDraft.step, REMINDER_STEP), isNotNull(sequenceDraft.approvedAt)));
    }
    return moved;
  });
}

export const liveReplyPorts: ReplyPorts = { findMembers: findSentMembers, applyReplies: applyReplyUpdates };
