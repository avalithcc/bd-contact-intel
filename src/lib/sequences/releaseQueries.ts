/**
 * DB layer and the REAL ports of the release runner. Library code: nothing under src/app imports it until PR 13.
 *
 * Reads are bounded and index-friendly: ONE statement for every candidate (approved + due, with the facts every
 * pre-send check needs as correlated subqueries, so there is no per-row query), ONE indexed count of today's recorded
 * sends per account (`sequence_send_claim_sent_account_date_idx`), and the company-wide suppression list. Holds are
 * written in one statement per batch.
 *
 * Normalization: raw `sql` returns timestamps as strings and counts as numbers/strings, so everything is converted in
 * `toCandidate`. The clock is passed as an ISO string cast to timestamptz (postgres-js rejects a JS Date in a raw
 * template).
 *
 * The claim is the at-most-once guarantee (design D10): INSERT ... ON CONFLICT DO NOTHING against the partial unique
 * index (member, step) WHERE outcome <> 'failed', taken before the Gmail call. It is an INSERT ... SELECT so it also
 * re-checks the step's required state, which closes the window in which a BD cancels an approval after the candidates
 * were read. A claim that stays `pending` is never resent (preSendChecks: manual_check).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sequenceMember } from "@/db/schema";
import { sendGmailMessageFromAccount } from "@/lib/gmail/send";
import { miamiCalendarDate } from "./miamiTime";
import { assertTransition } from "./memberState";
import type { HoldReason } from "./preSendChecks";
import { recipientMarket } from "./recipientMarket";
import { generateReminderDraft } from "./draftQueries";
import { parseSchedule, reminderDueAt, reminderReleaseAt, step1DueAt } from "./schedule";
import type { HoldChange, ReleaseCandidate, RunnerPorts } from "./runSequenceRelease";
import { listSuppressionRules } from "./suppressionQueries";

const MAX_CANDIDATES = 500;
type Row = Record<string, unknown>;
const rowsOf = <T>(r: unknown) => r as T[];
const toDate = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(v as string));
const sameCompany = sql`(c.company_key = p.company_key or c.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))`;

function toCandidate(r: Row): ReleaseCandidate {
  const step = Number(r.step) as 1 | 2;
  const schedule = parseSchedule(r.schedule);
  const approvedAt = toDate(r.approved_at)!;
  const dueAt =
    step === 1
      ? (toDate(r.scheduled_for) ?? step1DueAt(approvedAt, schedule))
      : // "Adelantar recordatorio" moves only member.reminder_due_at, so a reminder's release instant is derived, not stored.
        reminderReleaseAt(toDate(r.reminder_due_at)!, approvedAt, schedule)!;
  return {
    id: r.member_id as string, sequenceId: r.sequence_id as string, ownerBdId: r.owner_bd_id as string, personId: r.person_id as string,
    accountId: r.account_id as string, dailyCap: Number(r.daily_send_cap), step, dueAt, approvedAt, schedule,
    memberState: r.state as string, draftApproved: true, repliedAt: toDate(r.replied_at), holdReason: (r.hold_reason ?? null) as HoldReason | null,
    email: (r.email ?? null) as string | null, merged: Boolean(r.merged), hasClientStatus: Boolean(r.has_client_status),
    market: recipientMarket({ personCountry: r.person_country as string | null, companyCountry: r.company_country as string | null, postingMarkets: r.posting_markets as string[] }),
    subject: r.subject as string, body: r.body as string, accountStatus: r.account_status as string, accountEmail: r.account_email as string,
    lastSyncedAt: toDate(r.last_synced_at), activeClaim: (r.active_claim ?? null) as "pending" | "sent" | null,
    step1RfcMessageId: (r.step1_rfc ?? null) as string | null, step1ThreadId: (r.step1_thread ?? null) as string | null,
  };
}

/** Approved, due-or-overdue steps: step 1 for `approved` members, the reminder for `sent` members. Oldest due first. */
export async function listReleaseCandidates(now: Date): Promise<ReleaseCandidate[]> {
  const iso = now.toISOString();
  const rows = rowsOf<Row>(
    await db.execute(sql`
      select sm.id::text as member_id, sm.sequence_id::text as sequence_id, s.owner_bd_id::text as owner_bd_id, sm.person_id::text as person_id,
             s.email_account_id::text as account_id, s.daily_send_cap, s.schedule, d.step, d.subject, d.body, d.scheduled_for, d.approved_at,
             sm.state, sm.replied_at, sm.reminder_due_at, sm.hold_reason, p.email, (p.merged_into_id is not null) as merged, p.country as person_country,
             (select c.country from company c where ${sameCompany} limit 1) as company_country,
             coalesce((select json_agg(distinct jp.market) from job_posting jp where jp.is_it = true and jp.closed_at is null
                and (jp.company_key = p.company_key or jp.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))), '[]'::json) as posting_markets,
             exists (select 1 from company c where ${sameCompany} and c.client_status is not null) as has_client_status,
             ea.status as account_status, ea.email_address as account_email, ea.last_synced_at,
             (select cl.outcome from sequence_send_claim cl where cl.sequence_member_id = sm.id and cl.step = d.step and cl.outcome <> 'failed' limit 1) as active_claim,
             s1.rfc as step1_rfc, s1.thread as step1_thread
      from sequence_draft d
      join sequence_member sm on sm.id = d.sequence_member_id
      join sequence s on s.id = sm.sequence_id
      join email_account ea on ea.id = s.email_account_id
      join person p on p.id = sm.person_id
      left join lateral (
        select coalesce(cl.rfc_message_id, em.rfc_message_id) as rfc, cl.gmail_thread_id as thread
        from sequence_send_claim cl
        left join email_message em on em.bd_id = ea.bd_id and em.gmail_message_id = cl.gmail_message_id
        where d.step = 2 and cl.sequence_member_id = sm.id and cl.step = 1 and cl.outcome = 'sent' limit 1
      ) s1 on true
      where d.approved_at is not null
        and ((d.step = 1 and sm.state = 'approved' and d.scheduled_for <= ${iso}::timestamptz)
          or (d.step = 2 and sm.state = 'sent' and sm.reminder_due_at <= ${iso}::timestamptz))
      order by coalesce(sm.reminder_due_at, d.scheduled_for), d.approved_at, sm.id
      limit ${MAX_CANDIDATES}`),
  );
  return rows.map(toCandidate);
}

/**
 * Today's budget use per sending account, on `now`'s Miami day: recorded sends PLUS today's pending claims. A pending
 * claim whose email may have left is invisible otherwise, and overlapping runs could then exceed the cap. Tradeoff,
 * taken on purpose: a claim that never actually sent eats a slot for that Miami day. That fails safe, the right
 * direction for a daily cap on client email. Failed claims never count. Pending rows have no miami_send_date, so they
 * are dated by claimed_at in Miami time. UNION ALL keeps the sent half on the partial index
 * (`sequence_send_claim_sent_account_date_idx`); the pending half reads a handful of rows (one per unresolved crash or
 * in-flight send), so no new index is needed.
 */
export async function countSentToday(now: Date): Promise<Map<string, number>> {
  const day = miamiCalendarDate(now);
  const rows = rowsOf<{ account_id: string; used: number | string }>(
    await db.execute(sql`
      select account_id, count(*) as used from (
        select sending_account_id::text as account_id from sequence_send_claim where outcome = 'sent' and miami_send_date = ${day}::date
        union all
        select sending_account_id::text from sequence_send_claim
        where outcome = 'pending' and (claimed_at at time zone 'America/New_York')::date = ${day}::date
      ) used_today group by account_id`),
  );
  return new Map(rows.map((r) => [r.account_id, Number(r.used)]));
}

export async function setHolds(changes: HoldChange[]): Promise<void> {
  if (!changes.length) return;
  const values = sql.join(changes.map((h) => sql`(${h.memberId}::uuid, ${h.state}::text, ${h.reason}::text)`), sql`, `);
  await db.execute(sql`
    update sequence_member sm set hold_reason = v.reason, hold_at = case when v.reason is null then null else now() end
    from (values ${values}) as v(id, state, reason)
    where sm.id = v.id and sm.state = v.state and sm.hold_reason is distinct from v.reason`);
}

/** The state a step needs to be released. Hard-coded here, NOT read from the candidate: see claimStep. */
const REQUIRED_STATE = { 1: "approved", 2: "sent" } as const;

/**
 * The at-most-once claim. Returns the claim id, or null when another run holds the step or the member is not releasable.
 * The conditions live IN the statement and come from the step, not from the caller, so inertness guarantee 2 (only
 * approved members are ever released) holds here even if preSendChecks never ran or a caller forges `memberState`.
 * A reminder additionally needs no recorded reply and a sent step 1 claim.
 */
export async function claimStep(c: ReleaseCandidate): Promise<string | null> {
  const reminderOnly =
    c.step === 2
      ? sql`and sm.replied_at is null and exists (select 1 from sequence_send_claim s1 where s1.sequence_member_id = sm.id and s1.step = 1 and s1.outcome = 'sent')`
      : sql``;
  const [row] = rowsOf<{ id: string }>(
    await db.execute(sql`
      insert into sequence_send_claim (sequence_member_id, step, sending_account_id, outcome)
      select sm.id, d.step, ${c.accountId}::uuid, 'pending'
      from sequence_member sm join sequence_draft d on d.sequence_member_id = sm.id and d.step = ${c.step}
      where sm.id = ${c.id}::uuid and sm.state = ${REQUIRED_STATE[c.step]} and d.approved_at is not null ${reminderOnly}
      on conflict do nothing returning id::text as id`),
  );
  return row?.id ?? null;
}

export async function failClaim(claimId: string, error: string): Promise<void> {
  await db.execute(sql`update sequence_send_claim set outcome = 'failed', error = ${error} where id = ${claimId}::uuid and outcome = 'pending'`);
}

/** One transaction: the claim becomes `sent`, the member moves through the state machine, a hold is cleared. */
export async function recordSent(c: ReleaseCandidate, claimId: string, sent: { messageId: string; threadId: string }, sentAt: Date): Promise<void> {
  await db.transaction(async (tx) => {
    // The Message-ID Gmail assigned is on the email_message row recordSentEmail just wrote; the sync fills it later if absent.
    await tx.execute(sql`
      update sequence_send_claim set outcome = 'sent', sent_at = ${sentAt.toISOString()}::timestamptz, miami_send_date = ${miamiCalendarDate(sentAt)}::date,
        gmail_message_id = ${sent.messageId}, gmail_thread_id = ${sent.threadId},
        rfc_message_id = (select em.rfc_message_id from email_message em join email_account ea on ea.bd_id = em.bd_id
                          where ea.id = ${c.accountId}::uuid and em.gmail_message_id = ${sent.messageId} limit 1)
      where id = ${claimId}::uuid and outcome = 'pending'`);
    const cleared = { holdReason: null, holdAt: null };
    if (c.step === 1) assertTransition("approved", "sent", "release_step1");
    else assertTransition("sent", "no_reply", "release_step2");
    const moved = await tx
      .update(sequenceMember)
      .set(c.step === 1 ? { state: "sent", sentAt, reminderDueAt: reminderDueAt(sentAt, c.schedule), ...cleared } : { state: "no_reply", ...cleared })
      .where(and(eq(sequenceMember.id, c.id), eq(sequenceMember.state, REQUIRED_STATE[c.step])))
      .returning({ id: sequenceMember.id });
    if (!moved.length) throw new Error(`member ${c.id} left state ${c.memberState} while its send was being recorded`);
  });
}

export const liveRunnerPorts: RunnerPorts = {
  now: () => new Date(),
  load: async (now) => ({ candidates: await listReleaseCandidates(now), sentToday: await countSentToday(now), suppression: await listSuppressionRules() }),
  setHolds,
  claim: claimStep,
  send: (c, message) => sendGmailMessageFromAccount({ accountId: c.accountId, ...message }),
  failClaim,
  recordSent,
  draftReminder: async (c) => void (await generateReminderDraft(c.ownerBdId, c.sequenceId, c.id)),
};
