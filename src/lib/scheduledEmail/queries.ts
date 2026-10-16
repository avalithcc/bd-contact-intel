/**
 * DB side of scheduled-send. Every status change is ONE guarded UPDATE (`where status = ...`), so two concurrent callers
 * can never both win a row. Dates reach SQL only through drizzle columns or DB-side `now()`, never as raw JS Dates.
 */
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, scheduledEmail, type ScheduledEmail } from "@/db/schema";
import {
  LOCK_MS,
  OPEN_STATUSES,
  PENDING_STATUSES,
  STALE_SENDING_MS,
  planSchedule,
  type ScheduleRefusal,
} from "./plan";

export type ScheduleResult = { ok: true; id: string } | { ok: false; reason: ScheduleRefusal };
export type EditResult = { ok: true } | { ok: false; reason: ScheduleRefusal | "not_found" };

const lockSeconds = LOCK_MS / 1000;
// A 'scheduled' row is changeable only while it is still more than the lock window away; held/failed rows always are.
const changeable = sql`(${scheduledEmail.status} <> 'scheduled' or ${scheduledEmail.sendAt} > now() + make_interval(secs => ${lockSeconds}))`;

async function countPending(bdId: string, run: Pick<typeof db, "select"> = db): Promise<number> {
  const [row] = await run
    .select({ n: count() })
    .from(scheduledEmail)
    .where(and(eq(scheduledEmail.bdId, bdId), inArray(scheduledEmail.status, [...PENDING_STATUSES])));
  return Number(row?.n ?? 0);
}

export async function scheduleEmail(input: {
  bdId: string;
  personId: string;
  toAddress: string;
  subject: string;
  body: string;
  sendAt: Date;
  replyThreadId?: string;
}): Promise<ScheduleResult> {
  return db.transaction(async (tx) => {
    // Serialises this BD's scheduling so the count below and the insert cannot interleave with another request.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`scheduled_email:${input.bdId}`}))`);
    const plan = planSchedule({ sendAt: input.sendAt, now: new Date(), pendingCount: await countPending(input.bdId, tx) });
    if (!plan.ok) return plan;
    const [row] = await tx.insert(scheduledEmail).values({ ...input, sendAt: plan.sendAt }).returning({ id: scheduledEmail.id });
    return { ok: true as const, id: row!.id };
  });
}

async function refusalFor(id: string, bdId: string): Promise<EditResult> {
  const [row] = await db.select({ id: scheduledEmail.id }).from(scheduledEmail).where(and(eq(scheduledEmail.id, id), eq(scheduledEmail.bdId, bdId)));
  return { ok: false, reason: row ? "schedule_locked" : "not_found" }; // someone else's row is indistinguishable from none
}

export async function editScheduled(input: { id: string; bdId: string; subject: string; body: string; sendAt: Date }): Promise<EditResult> {
  const [row] = await db.select().from(scheduledEmail).where(and(eq(scheduledEmail.id, input.id), eq(scheduledEmail.bdId, input.bdId)));
  if (!row) return { ok: false, reason: "not_found" };
  // Only an untouched time on a still-scheduled row skips the 5-minute rule (so text can be fixed up to the lock).
  const sameTime = row.status === "scheduled" && input.sendAt.getTime() === row.sendAt.getTime();
  if (!sameTime) {
    const plan = planSchedule({ sendAt: input.sendAt, now: new Date(), pendingCount: row.status === "failed" ? await countPending(input.bdId) : 0 });
    if (!plan.ok) return plan;
  }
  const rebaseline = row.status === "scheduled" ? {} : { replyBaselineAt: sql`now()` };
  const updated = await db
    .update(scheduledEmail)
    .set({ subject: input.subject, body: input.body, sendAt: input.sendAt, status: "scheduled", error: null, updatedAt: sql`now()`, ...rebaseline })
    .where(and(eq(scheduledEmail.id, input.id), eq(scheduledEmail.bdId, input.bdId), inArray(scheduledEmail.status, [...OPEN_STATUSES]), changeable))
    .returning({ id: scheduledEmail.id });
  return updated.length ? { ok: true } : refusalFor(input.id, input.bdId);
}

export async function cancelScheduled(input: { id: string; bdId: string }): Promise<EditResult> {
  const updated = await db
    .update(scheduledEmail)
    .set({ status: "cancelled", updatedAt: sql`now()` })
    .where(and(eq(scheduledEmail.id, input.id), eq(scheduledEmail.bdId, input.bdId), inArray(scheduledEmail.status, [...OPEN_STATUSES]), changeable))
    .returning({ id: scheduledEmail.id });
  return updated.length ? { ok: true } : refusalFor(input.id, input.bdId);
}

const dueNow = sql`${scheduledEmail.status} = 'scheduled' and ${scheduledEmail.sendAt} <= now()`;
// An inbound, non-automatic message from this person to this BD, newer than the row's baseline.
const repliedSinceBaseline = sql`exists (
  select 1 from email_message em join email_message_person emp on emp.email_message_id = em.id
  where em.bd_id = ${scheduledEmail.bdId} and emp.person_id = ${scheduledEmail.personId}
    and em.direction = 'inbound' and em.is_automatic = false and em.sent_at > ${scheduledEmail.replyBaselineAt})`;

export async function countDue(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(scheduledEmail).where(dueNow);
  return Number(row?.n ?? 0);
}

/** Due rows whose contact answered go on hold (one statement). They stay there until the BD decides. */
export async function holdReplied(): Promise<number> {
  const held = await db
    .update(scheduledEmail)
    .set({ status: "on_hold", updatedAt: sql`now()` })
    .where(and(dueNow, repliedSinceBaseline))
    .returning({ id: scheduledEmail.id });
  return held.length;
}

export type ClaimedEmail = ScheduledEmail & { signatureHtml: string | null };

/** Atomically moves up to `limit` due rows to 'sending' (skip locked: a concurrent run takes different rows). */
export async function claimDue(limit: number): Promise<ClaimedEmail[]> {
  const claimed = await db
    .update(scheduledEmail)
    .set({ status: "sending", updatedAt: sql`now()` })
    .where(sql`${scheduledEmail.id} in (
      select s.id from scheduled_email s where s.status = 'scheduled' and s.send_at <= now()
      order by s.send_at limit ${limit} for update skip locked) and ${scheduledEmail.status} = 'scheduled'`)
    .returning();
  if (!claimed.length) return [];
  const signatures = await db.select({ id: bd.id, signatureHtml: bd.signatureHtml }).from(bd).where(inArray(bd.id, [...new Set(claimed.map((c) => c.bdId))]));
  const byBd = new Map(signatures.map((s) => [s.id, s.signatureHtml]));
  return claimed.map((c) => ({ ...c, signatureHtml: byBd.get(c.bdId) ?? null }));
}

export async function markSent(id: string, gmailMessageId: string): Promise<void> {
  await db.update(scheduledEmail).set({ status: "sent", gmailMessageId, sentAt: sql`now()`, updatedAt: sql`now()` }).where(and(eq(scheduledEmail.id, id), eq(scheduledEmail.status, "sending")));
}

export async function markFailed(id: string, code: string): Promise<void> {
  await db.update(scheduledEmail).set({ status: "failed", error: code, updatedAt: sql`now()` }).where(and(eq(scheduledEmail.id, id), eq(scheduledEmail.status, "sending")));
}

/** A 'sending' row older than STALE_SENDING_MS belongs to a dead run: surfaced as failed, never retried. */
export async function sweepStale(): Promise<number> {
  const swept = await db
    .update(scheduledEmail)
    .set({ status: "failed", error: "outcome_unknown", updatedAt: sql`now()` })
    .where(and(eq(scheduledEmail.status, "sending"), sql`${scheduledEmail.updatedAt} < now() - make_interval(secs => ${STALE_SENDING_MS / 1000})`))
    .returning({ id: scheduledEmail.id });
  return swept.length;
}
