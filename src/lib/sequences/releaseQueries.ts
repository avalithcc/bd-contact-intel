/**
 * DB layer and the REAL ports of the release runner. Library code: the only file under src/app that imports it is the cron route (src/app/api/sequences/run/route.ts).
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
import { companyCountrySql } from "./rosterQuery";
import { generateReminderDraft } from "./draftQueries";
import { parseSchedule, reminderDueAt } from "./schedule";
import { pickReleaseKeys, releaseInstant, type SlimRow } from "./releaseSelection";
import type { HoldChange, ReleaseCandidate, RunnerPorts } from "./runSequenceRelease";
import { listSuppressionRules } from "./suppressionQueries";
import { openPostingSql } from "@/lib/hiring/openPosting";

const MAX_CANDIDATES = 500;
/** The members an immediate release may look at, and whose Sequences they must belong to. */
export interface ReleaseScope {
  memberIds: readonly string[];
  ownerBdId: string;
}
/** Hard bound on the slim scan that precedes the cap. Hitting it is reported as truncation too. */
const MAX_SCAN = 5000;
type Row = Record<string, unknown>;
const rowsOf = <T>(r: unknown) => r as T[];
const toDate = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(v as string));
const sameCompany = sql`(c.company_key = p.company_key or c.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))`;

/**
 * THE definition of "a genuine reply after step 1" for the runner, read from email_message (the source of truth) and used
 * by BOTH the candidate read and the claim, so they cannot disagree. Inbound, not automatic, and the link is not a
 * thread attribution (the sender is an address we do not hold). Any BD's mailbox counts, as in applyReplies.ts. Uses
 * email_message_person_person_idx. Rows synced before 0044 default is_automatic to false, which fails toward holding.
 */
const genuineReplyAfterSend = sql`select em.sent_at from email_message_person emp join email_message em on em.id = emp.email_message_id
  where emp.person_id = sm.person_id and em.direction = 'inbound' and em.is_automatic = false and emp.match_confidence <> 'thread' and em.sent_at > sm.sent_at`;

function toCandidate(r: Row): ReleaseCandidate {
  const step = Number(r.step) as 1 | 2;
  const schedule = parseSchedule(r.schedule);
  const approvedAt = toDate(r.approved_at)!;
  // The same helper that ordered the cap (releaseSelection): "Adelantar recordatorio" moves only member.reminder_due_at, so a
  // reminder's release instant is derived, not stored.
  const dueAt = releaseInstant({ step, scheduledFor: toDate(r.scheduled_for), reminderDueAt: toDate(r.reminder_due_at), approvedAt, schedule });
  return {
    id: r.member_id as string, sequenceId: r.sequence_id as string, ownerBdId: r.owner_bd_id as string, personId: r.person_id as string,
    accountId: r.account_id as string, dailyCap: Number(r.daily_send_cap), step, dueAt, approvedAt, schedule,
    memberState: r.state as string, draftApproved: true, repliedAt: toDate(r.replied_at), inboundReplyAt: toDate(r.inbound_reply_at), holdReason: (r.hold_reason ?? null) as HoldReason | null,
    email: (r.email ?? null) as string | null, merged: Boolean(r.merged), hasClientStatus: Boolean(r.has_client_status),
    market: recipientMarket({ personCountry: r.person_country as string | null, companyCountry: r.company_country as string | null, postingMarkets: r.posting_markets as string[] }),
    subject: r.subject as string, body: r.body as string, accountStatus: r.account_status as string, accountEmail: r.account_email as string,
    lastSyncedAt: toDate(r.last_synced_at), activeClaim: (r.active_claim ?? null) as "pending" | "sent" | null, activeClaimAt: toDate(r.active_claim_at),
    step1RfcMessageId: (r.step1_rfc ?? null) as string | null, step1ThreadId: (r.step1_thread ?? null) as string | null,
  };
}

const dueWhere = (iso: string) => sql`d.approved_at is not null
        and ((d.step = 1 and sm.state = 'approved' and d.scheduled_for <= ${iso}::timestamptz)
          or (d.step = 2 and sm.state = 'sent' and sm.reminder_due_at <= ${iso}::timestamptz))`;

/**
 * Approved, due-or-overdue steps: step 1 for `approved` members, the reminder for `sent` members. Two statements: a slim
 * scan (no subqueries) picks which `limit` steps to load by RELEASE instant (releaseSelection, the same expression
 * toCandidate uses), then ONE statement loads the facts for exactly those. `truncated` means more were due than fit:
 * the oldest are taken first, the rest wait, and the runner reports it (a permanently held member keeps its slot).
 *
 * The slim scan orders by the RAW due column, not by `sm.id`: SQL cannot reproduce `releaseInstant` (Miami DST
 * wall-clock math), so this is only an approximation of the real order — but it is approximately chronological, and
 * `pickReleaseKeys` then orders the survivors exactly. Cutting the scan by uuid instead, as this first did, means the
 * oldest due member can sit behind lower-uuid members on every single run, permanently if those are held.
 */
export async function loadReleaseCandidates(now: Date, limit = MAX_CANDIDATES, scope?: ReleaseScope): Promise<{ candidates: ReleaseCandidate[]; truncated: boolean }> {
  const iso = now.toISOString();
  if (scope && !scope.memberIds.length) return { candidates: [], truncated: false };
  // "Enviar ahora": the same read and the same checks, narrowed to the members the BD just approved (and to that BD's own Sequences).
  const scoped = scope ? sql`and sm.id in (${sql.join(scope.memberIds.map((id) => sql`${id}::uuid`), sql`, `)}) and s.owner_bd_id = ${scope.ownerBdId}::uuid` : sql``;
  // Two branches instead of one OR across both tables, so each can use its partial index (sequence_member_approved_idx and
  // sequence_member_reminder_due_idx): an idle tick reads the few approved members and the sent ones with a reminder date, not
  // every member. The same rows as `dueWhere`, which still guards the full read below.
  const slim = rowsOf<Row>(
    await db.execute(sql`
      select * from (
        (select sm.id::text as member_id, d.step, d.scheduled_for, sm.reminder_due_at, d.approved_at, s.schedule
           from sequence_member sm join sequence_draft d on d.sequence_member_id = sm.id and d.step = 1 join sequence s on s.id = sm.sequence_id
           where sm.state = 'approved' and d.approved_at is not null and d.scheduled_for <= ${iso}::timestamptz ${scoped})
        union all
        (select sm.id::text, d.step, d.scheduled_for, sm.reminder_due_at, d.approved_at, s.schedule
           from sequence_member sm join sequence_draft d on d.sequence_member_id = sm.id and d.step = 2 join sequence s on s.id = sm.sequence_id
           where sm.state = 'sent' and sm.reminder_due_at <= ${iso}::timestamptz and d.approved_at is not null ${scoped})
      ) due
      order by coalesce(reminder_due_at, scheduled_for), member_id limit ${MAX_SCAN + 1}`),
  );
  const slimRows: SlimRow[] = slim.slice(0, MAX_SCAN).map((r) => ({
    id: r.member_id as string, step: Number(r.step) as 1 | 2, scheduledFor: toDate(r.scheduled_for), reminderDueAt: toDate(r.reminder_due_at),
    approvedAt: toDate(r.approved_at)!, schedule: parseSchedule(r.schedule),
  }));
  const picked = pickReleaseKeys(slimRows, now, limit);
  if (!picked.keys.length) return { candidates: [], truncated: picked.truncated || slim.length > MAX_SCAN };
  const keys = sql.join(picked.keys.map((k) => sql`(${k.id}::uuid, ${k.step}::int)`), sql`, `);
  const rows = rowsOf<Row>(
    await db.execute(sql`
      select sm.id::text as member_id, sm.sequence_id::text as sequence_id, s.owner_bd_id::text as owner_bd_id, sm.person_id::text as person_id,
             s.email_account_id::text as account_id, s.daily_send_cap, s.schedule, d.step, d.subject, d.body, d.scheduled_for, d.approved_at,
             sm.state, sm.replied_at, case when d.step = 2 then (select min(g.sent_at) from (${genuineReplyAfterSend}) g) end as inbound_reply_at, sm.reminder_due_at, sm.hold_reason, p.email, (p.merged_into_id is not null) as merged, p.country as person_country,
             ${companyCountrySql} as company_country,
             coalesce((select json_agg(distinct jp.market) from job_posting jp where jp.is_it = true and ${openPostingSql("jp")}
                and (jp.company_key = p.company_key or jp.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))), '[]'::json) as posting_markets,
             exists (select 1 from company c where ${sameCompany} and c.client_status is not null) as has_client_status,
             ea.status as account_status, ea.email_address as account_email, ea.last_synced_at,
             (select cl.outcome from sequence_send_claim cl where cl.sequence_member_id = sm.id and cl.step = d.step and cl.outcome <> 'failed' limit 1) as active_claim,
             (select cl.claimed_at from sequence_send_claim cl where cl.sequence_member_id = sm.id and cl.step = d.step and cl.outcome <> 'failed' limit 1) as active_claim_at,
             s1.rfc as step1_rfc, s1.thread as step1_thread
      from (values ${keys}) as k(id, step)
      join sequence_draft d on d.sequence_member_id = k.id and d.step = k.step
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
      where ${dueWhere(iso)} ${scoped}`),
  );
  return { candidates: rows.map(toCandidate), truncated: picked.truncated || slim.length > MAX_SCAN };
}

export async function listReleaseCandidates(now: Date, limit = MAX_CANDIDATES): Promise<ReleaseCandidate[]> {
  return (await loadReleaseCandidates(now, limit)).candidates;
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
 * The text and approval the candidate was read with, re-checked against the row NOW. The send uses `c.subject`/`c.body`,
 * so a BD who edited (and re-approved) since the read must not have the old text go out: the claim, not the read, is the
 * authority. `approved_at` is compared at millisecond precision (the candidate carries a JS Date).
 */
const sameDraft = (c: ReleaseCandidate) =>
  sql`and date_trunc('milliseconds', d.approved_at) = ${c.approvedAt.toISOString()}::timestamptz and d.subject = ${c.subject} and d.body = ${c.body}`;

/**
 * The at-most-once claim. Returns the claim id, or null when another run holds the step or the member is not releasable.
 * The conditions live IN the statement and come from the step, not from the caller, so inertness guarantee 2 (only
 * approved members are ever released) holds here even if preSendChecks never ran or a caller forges `memberState`.
 * A reminder additionally needs no recorded reply and a sent step 1 claim.
 */
export async function claimStep(c: ReleaseCandidate, now: Date = new Date()): Promise<string | null> {
  // A step 1 moved LATER since the candidate was read ("Cambiar") must not go out at the old time.
  const notMovedLater = c.step === 1 ? sql`and (d.scheduled_for is null or date_trunc('milliseconds', d.scheduled_for) <= ${c.dueAt.toISOString()}::timestamptz)` : sql``;
  const reminderOnly =
    c.step === 2
      ? sql`and sm.replied_at is null and not exists (${genuineReplyAfterSend}) and exists (select 1 from sequence_send_claim s1 where s1.sequence_member_id = sm.id and s1.step = 1 and s1.outcome = 'sent')`
      : sql``;
  // The daily cap is enforced HERE, not only in the plan: two runs that both read "14 of 15" would otherwise each plan one more.
  // A transaction-scoped advisory lock per sending account serialises the claims of one account, and the insert only happens while
  // today's sent + pending claims are under the cap, so the second claim sees the first one's row. Steps 1 and 2 share the count.
  const day = miamiCalendarDate(now);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${c.accountId}))`);
    const [row] = rowsOf<{ id: string }>(
      await tx.execute(sql`
        insert into sequence_send_claim (sequence_member_id, step, sending_account_id, outcome)
        select sm.id, d.step, ${c.accountId}::uuid, 'pending'
        from sequence_member sm join sequence_draft d on d.sequence_member_id = sm.id and d.step = ${c.step}
        where sm.id = ${c.id}::uuid and sm.state = ${REQUIRED_STATE[c.step]} and d.approved_at is not null ${sameDraft(c)} ${notMovedLater} ${reminderOnly}
          and (select count(*) from sequence_send_claim u where u.sending_account_id = ${c.accountId}::uuid
                 and ((u.outcome = 'sent' and u.miami_send_date = ${day}::date)
                   or (u.outcome = 'pending' and (u.claimed_at at time zone 'America/New_York')::date = ${day}::date))) < ${c.dailyCap}
        on conflict do nothing returning id::text as id`),
    );
    return row?.id ?? null;
  });
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

/**
 * The runner's read. A tick with nothing due costs ONE statement (the slim scan): the per-account counts and the
 * suppression list are only read when there is something to release, so a every-minute cron stays cheap.
 */
async function loadForRun(now: Date, scope?: ReleaseScope) {
  const loaded = await loadReleaseCandidates(now, MAX_CANDIDATES, scope);
  if (!loaded.candidates.length) return { ...loaded, sentToday: new Map<string, number>(), suppression: [] };
  const caps = scope ? await accountCapsWithDueMembers(now, loaded.candidates) : lowestCapPerAccount(loaded.candidates);
  const candidates = loaded.candidates.map((c) => ({ ...c, dailyCap: Math.min(c.dailyCap, caps.get(c.accountId) ?? c.dailyCap) }));
  return { ...loaded, candidates, sentToday: await countSentToday(now), suppression: await listSuppressionRules() };
}

const lowestCapPerAccount = (candidates: readonly ReleaseCandidate[]) => {
  const out = new Map<string, number>();
  for (const c of candidates) out.set(c.accountId, Math.min(out.get(c.accountId) ?? Infinity, c.dailyCap));
  return out;
};

/**
 * The cap an account really has: the LOWEST among all its Sequences that have a due member, exactly what the full cron's plan
 * sees. A release narrowed to some members would otherwise take their Sequence's own cap and let a Sequence with a bigger cap
 * spend what a stricter one on the same mailbox is entitled to.
 */
async function accountCapsWithDueMembers(now: Date, candidates: readonly ReleaseCandidate[]): Promise<Map<string, number>> {
  const iso = now.toISOString();
  const accounts = sql.join([...new Set(candidates.map((c) => c.accountId))].map((id) => sql`${id}::uuid`), sql`, `);
  const rows = rowsOf<{ account_id: string; cap: number | string }>(
    await db.execute(sql`
      select s.email_account_id::text as account_id, min(s.daily_send_cap) as cap
      from sequence s
      where s.email_account_id in (${accounts})
        and exists (select 1 from sequence_draft d join sequence_member sm on sm.id = d.sequence_member_id where sm.sequence_id = s.id and ${dueWhere(iso)})
      group by s.email_account_id`),
  );
  return new Map(rows.map((r) => [r.account_id, Number(r.cap)]));
}

export const liveRunnerPorts: RunnerPorts = {
  now: () => new Date(),
  load: (now) => loadForRun(now),
  setHolds,
  claim: claimStep,
  send: (c, message) => sendGmailMessageFromAccount({ accountId: c.accountId, ...message }),
  failClaim,
  recordSent,
  draftReminder: async (c) => void (await generateReminderDraft(c.ownerBdId, c.sequenceId, c.id)),
};

/** The real ports narrowed to some members: what "Enviar ahora" releases right after approval. */
export const scopedRunnerPorts = (scope: ReleaseScope): RunnerPorts => ({ ...liveRunnerPorts, load: (now) => loadForRun(now, scope) });
