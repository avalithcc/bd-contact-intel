/**
 * Rewrites the subject of every UNSENT step 2 reminder draft to `Re: <step 1 subject>`.
 *
 * Why: a reminder is always sent threaded onto step 1, but it used to go out with its own model-generated subject, which
 * drifted ("Capacidad senior para el equipo de Daniel", "... para Avalith"). From now on draftQueries.ts derives the subject
 * with reminderSubject(); this brings the drafts generated before that change in line.
 *
 * Never touched: a draft whose member already has a step 2 claim that is not 'failed' ('sent' is history; 'pending' is a
 * send in flight). Drafts with no step 1 draft, or already correct, are skipped. Hand-edited subjects ARE rewritten (the
 * owner's rule is that the subject is inherited), and the dry run says how many.
 *
 * Dry run by default; prints one line per row (member, old, new). --execute --actor=<bd id> writes all rows in ONE
 * transaction, batched, with one audit_log row (action 'sequence_reminder_subject_backfill') whose metadata lists
 * {draftId, oldSubject, newSubject}.
 * Revert: for each entry, `update sequence_draft set subject = <oldSubject> where id = <draftId>`.
 *
 *   npx tsx --env-file=.env scripts/backfill-reminder-subjects.ts
 *   npx tsx --env-file=.env scripts/backfill-reminder-subjects.ts --execute --actor=<bd id>
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { reminderSubject } from "@/lib/outreach/subjectRules";

const BATCH = 500;
type Row = { draft_id: string; member_id: string; old_subject: string; step1_subject: string | null; edited: boolean; approved: boolean; claimed: boolean };

async function main() {
  const execute = process.argv.includes("--execute");
  const actor = process.argv.find((a) => a.startsWith("--actor="))?.slice("--actor=".length);
  if (execute && !actor) {
    console.error("--execute requires --actor=<bd id>");
    process.exit(1);
  }

  const rows = (await db.execute(sql`
    select d2.id::text as draft_id, d2.sequence_member_id::text as member_id, d2.subject as old_subject, d1.subject as step1_subject,
           (d2.edited_at is not null) as edited, (d2.approved_at is not null) as approved,
           exists (select 1 from sequence_send_claim c where c.sequence_member_id = d2.sequence_member_id and c.step = 2 and c.outcome <> 'failed') as claimed
    from sequence_draft d2
    join sequence_member m on m.id = d2.sequence_member_id
    left join sequence_draft d1 on d1.sequence_member_id = d2.sequence_member_id and d1.step = 1
    -- Only members that can still send a reminder. The state 'sent' is the one the server releases step 2 from
    -- (approvalQueries and the release path both require it), so a draft on a discarded, replied or no_reply member is
    -- a dead row: rewriting it is work nobody can ever see. Two such rows carry a subject naming OUR OWN company,
    -- left over from the prompt-placeholder incident; inheriting those would have propagated it instead of fixing it.
    where d2.step = 2 and m.state = 'sent'
  `)) as unknown as Row[];

  const excludedClaimed = rows.filter((r) => r.claimed);
  const open = rows.filter((r) => !r.claimed);
  const noStep1 = open.filter((r) => !r.step1_subject?.trim());
  const candidates = open.filter((r) => r.step1_subject?.trim());
  const changes = candidates
    .map((r) => ({ draftId: r.draft_id, memberId: r.member_id, oldSubject: r.old_subject, newSubject: reminderSubject(r.step1_subject!), edited: r.edited, approved: r.approved }))
    .filter((c) => c.newSubject !== c.oldSubject);

  for (const c of changes) console.log(`${c.memberId}\t${JSON.stringify(c.oldSubject)} -> ${JSON.stringify(c.newSubject)}${c.edited ? "\t(hand-edited)" : ""}${c.approved ? "\t(APPROVED -> approval and review cleared)" : ""}`);
  console.log(
    `\nstep 2 drafts: ${rows.length}; excluded (reminder already sent or in flight): ${excludedClaimed.length}; no step 1 subject: ${noStep1.length}; ` +
      `already correct: ${candidates.length - changes.length}; to change: ${changes.length} (hand-edited among them: ${changes.filter((c) => c.edited).length}; approved among them: ${changes.filter((c) => c.approved).length})`,
  );

  if (!execute) {
    console.log("DRY RUN: nothing written. Re-run with --execute --actor=<bd id>.");
    process.exit(0);
  }
  if (changes.length === 0) {
    console.log("nothing to change.");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < changes.length; i += BATCH) {
      const chunk = changes.slice(i, i + BATCH);
      const values = sql.join(chunk.map((c) => sql`(${c.draftId}::uuid, ${c.newSubject})`), sql`, `);
      // The claim guard is repeated in the write so a send that started since the read above is never rewritten.
      await tx.execute(sql`
        update sequence_draft d set subject = v.subject,
          -- A rewritten subject cannot keep an approval that was given for the OLD text: the repo's own rule is that an
          -- edit after review clears it, so a bulk approval can never cover unseen content, and regenerating a subject
          -- (draftQueries.ts) clears exactly these columns. The BD re-opens and re-approves what will actually go out.
          reviewed_at = null, reviewed_by_bd_id = null, approved_at = null, approved_by_bd_id = null, scheduled_for = null
        from (values ${values}) as v(id, subject)
        where d.id = v.id and d.step = 2
          and exists (select 1 from sequence_member sm where sm.id = d.sequence_member_id and sm.state = 'sent')
          and not exists (select 1 from sequence_send_claim c where c.sequence_member_id = d.sequence_member_id and c.step = 2 and c.outcome <> 'failed')
      `);
    }
    await tx.insert(auditLog).values({
      action: "sequence_reminder_subject_backfill",
      actorBdId: actor!,
      metadata: { count: changes.length, approvalsCleared: changes.filter((c) => c.approved).length, changes: changes.map(({ draftId, oldSubject, newSubject, approved }) => ({ draftId, oldSubject, newSubject, approvalCleared: approved })) },
    });
  });
  console.log(`updated ${changes.length} draft(s) in one transaction.`);
  process.exit(0);
}
void main();
