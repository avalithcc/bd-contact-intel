/**
 * DB reads/writes for scripts/backfill-inbound-reply-verified.ts: Contacts that already replied
 * from their stored address before the sync started promoting on its own. The decision is the
 * same pure planner the sync uses; the SQL below only finds candidates, so the two cannot drift
 * on what counts as proof.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { applyReplyVerification, type ReplyTx } from "./inboundReplyVerificationDb";
import { assertWithinBackfillCap, BACKFILL_ROW_CAP, planReplyBackfill, type ReplyBackfillCandidate } from "./inboundReplyBackfillPlan";

export { BACKFILL_ROW_CAP, planReplyBackfill, type ReplyBackfillCandidate };

export const BACKFILL_AUDIT_ACTION = "inbound_reply_verified_backfill";

type RawRow = {
  id: string;
  email_normalized: string;
  email_status: string;
  email_source: string | null;
  reply_from: string;
  live_holders: number | string;
};

/** Correlated EXISTS (index-friendly through email_message_person.person_id), bounded by cap + 1. */
export async function readReplyBackfillCandidates(executor: Pick<typeof db, "execute">): Promise<ReplyBackfillCandidate[]> {
  const rows = await executor.execute<RawRow>(sql`
    select p.id::text as id, p.email_normalized, p.email_status, p.email_source,
      (select lower(em.from_address) from email_message_person emp
         join email_message em on em.id = emp.email_message_id
        where emp.person_id = p.id and em.direction = 'inbound' and lower(em.from_address) = p.email_normalized
        limit 1) as reply_from,
      (select count(*) from person q where q.email_normalized = p.email_normalized and q.merged_into_id is null)::int as live_holders
    from person p
    where p.merged_into_id is null
      and p.email_normalized is not null
      and p.email_status in ('probable', 'none')
      and exists (select 1 from email_message_person emp
         join email_message em on em.id = emp.email_message_id
        where emp.person_id = p.id and em.direction = 'inbound' and lower(em.from_address) = p.email_normalized)
    order by p.id
    limit ${BACKFILL_ROW_CAP + 1}
  `);
  return rows.map((r) => ({ id: r.id, emailNormalized: r.email_normalized, emailStatus: r.email_status, emailSource: r.email_source, replyFrom: r.reply_from, liveHolders: Number(r.live_holders) }));
}

/** One transaction: re-read, plan, guarded UPDATEs + history, one audit_log row. */
export async function executeReplyBackfill(actorBdId: string): Promise<{ updatedPersonIds: string[] }> {
  return db.transaction(async (tx: ReplyTx) => {
    const candidates = await readReplyBackfillCandidates(tx);
    assertWithinBackfillCap(candidates);
    const rows = planReplyBackfill(candidates);
    const updatedPersonIds = await applyReplyVerification(tx, rows);
    if (updatedPersonIds.length > 0) {
      const changed = new Set(updatedPersonIds);
      const idsWithOld = (old: string) => rows.filter((r) => r.historyRow.oldValue === old && changed.has(r.historyRow.personId)).map((r) => r.historyRow.personId);
      await tx.insert(auditLog).values({
        actorBdId,
        action: BACKFILL_AUDIT_ACTION,
        metadata: {
          predicate: "inbound email_message whose from_address = person.email_normalized, status probable|none, not merged",
          updatedCount: updatedPersonIds.length,
          previouslyProbableIds: idsWithOld("probable"),
          previouslyNoneIds: idsWithOld("none"),
          revertNote:
            "update person set email_status = 'probable' where id in (<previouslyProbableIds>); same with 'none' for <previouslyNoneIds>; " +
            "delete from person_property_history where source = 'inbound_reply' and property = 'emailStatus' and person_id in (<both lists>) and new_value = 'verified' and at >= <audit_log.at>",
        },
      });
    }
    return { updatedPersonIds };
  });
}
