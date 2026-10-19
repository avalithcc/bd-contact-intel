/**
 * DB side of scheduled-send. Every status change is ONE guarded UPDATE (`where status = ...`), so two concurrent callers
 * can never both win a row. Dates reach SQL only through drizzle columns or DB-side `now()`, never as raw JS Dates.
 */
import { and, asc, count, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, bd, emailAccount, person, scheduledEmail, task, type ScheduledEmail } from "@/db/schema";
import { recomputePersonStatus } from "@/lib/status/recompute";
import type { ValidatedAttachment } from "@/lib/email/attachments/load";
import { listScheduledAttachments, setScheduledAttachments, type AttachmentRow } from "@/lib/email/attachments/queries";
import { buildTaskActivityRow } from "@/lib/tasks/taskActivityBody";
import { buildFailureTask, failureTaskRef } from "./failureTask";
import {
  LOCK_MS,
  MAX_PENDING,
  OPEN_STATUSES,
  PENDING_STATUSES,
  STALE_SENDING_MS,
  planSchedule,
  type ScheduleRefusal,
  type ScheduledStatus,
} from "./plan";
import { replySnippet, type ScheduledItem } from "./view";

export type ScheduleResult = { ok: true; id: string } | { ok: false; reason: ScheduleRefusal };
export type EditResult = { ok: true } | { ok: false; reason: ScheduleRefusal | "not_found" };

const lockSeconds = LOCK_MS / 1000;
// A 'scheduled' row is changeable only while it is still more than the lock window away; held/failed rows always are.
const changeable = sql`(${scheduledEmail.status} <> 'scheduled' or ${scheduledEmail.sendAt} > now() + make_interval(secs => ${lockSeconds}))`;

type Runner = Pick<typeof db, "select" | "execute">;

/** Serialises one BD's scheduling so a count and the write that depends on it cannot interleave with another request. */
const lockBd = (tx: Runner, bdId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`scheduled_email:${bdId}`}))`);

async function countPending(bdId: string, run: Runner = db): Promise<number> {
  const [row] = await run
    .select({ n: count() })
    .from(scheduledEmail)
    .where(and(eq(scheduledEmail.bdId, bdId), inArray(scheduledEmail.status, [...PENDING_STATUSES])));
  return Number(row?.n ?? 0);
}

/** What an email-attachments-recipients compose adds to a scheduled row: the other "Para" contacts, Cc and the files it holds. */
export interface ScheduledCompose {
  recipientPersonIds: string[];
  ccAddresses: string[];
  attachments: ValidatedAttachment[];
  /** The uploader's auth user id (first folder of every path); the cron re-checks it before reading a file. */
  ownerAuthUid: string;
}

export async function scheduleEmail(input: {
  bdId: string;
  personId: string;
  toAddress: string;
  subject: string;
  body: string;
  sendAt: Date;
  replyThreadId?: string;
  compose?: ScheduledCompose;
}): Promise<ScheduleResult> {
  const { compose, ...row } = input;
  return db.transaction(async (tx) => {
    await lockBd(tx, input.bdId);
    const plan = planSchedule({ sendAt: input.sendAt, now: new Date(), pendingCount: await countPending(input.bdId, tx) });
    if (!plan.ok) return plan;
    const [inserted] = await tx
      .insert(scheduledEmail)
      .values({ ...row, sendAt: plan.sendAt, recipientPersonIds: compose?.recipientPersonIds ?? [], ccAddresses: compose?.ccAddresses ?? [] })
      .returning({ id: scheduledEmail.id });
    if (compose?.attachments.length) await setScheduledAttachments(tx, inserted!.id, input.bdId, compose.ownerAuthUid, compose.attachments);
    return { ok: true as const, id: inserted!.id };
  });
}

async function refusalFor(id: string, bdId: string): Promise<EditResult> {
  const [row] = await db.select({ id: scheduledEmail.id }).from(scheduledEmail).where(and(eq(scheduledEmail.id, id), eq(scheduledEmail.bdId, bdId)));
  return { ok: false, reason: row ? "schedule_locked" : "not_found" }; // someone else's row is indistinguishable from none
}

/** `compose` replaces the row's other recipients, Cc and files; left out, they are untouched. */
export async function editScheduled(input: { id: string; bdId: string; subject: string; body: string; sendAt: Date; compose?: ScheduledCompose }): Promise<EditResult> {
  const [row] = await db.select().from(scheduledEmail).where(and(eq(scheduledEmail.id, input.id), eq(scheduledEmail.bdId, input.bdId)));
  if (!row) return { ok: false, reason: "not_found" };
  // Only an untouched time on a still-scheduled row skips the 5-minute rule (so text can be fixed up to the lock).
  const sameTime = row.status === "scheduled" && input.sendAt.getTime() === row.sendAt.getTime();
  const rebaseline = row.status === "scheduled" ? {} : { replyBaselineAt: sql`now()` };
  const outcome = await db.transaction(async (tx) => {
    // A failed row returning to 'scheduled' adds to the pending count, so it takes the same lock as scheduleEmail.
    if (row.status === "failed") await lockBd(tx, input.bdId);
    if (!sameTime) {
      const plan = planSchedule({ sendAt: input.sendAt, now: new Date(), pendingCount: row.status === "failed" ? await countPending(input.bdId, tx) : 0 });
      if (!plan.ok) return plan;
    }
    const updated = await tx
      .update(scheduledEmail)
      .set({
        subject: input.subject,
        body: input.body,
        sendAt: input.sendAt,
        status: "scheduled",
        error: null,
        updatedAt: sql`now()`,
        ...rebaseline,
        ...(input.compose ? { recipientPersonIds: input.compose.recipientPersonIds, ccAddresses: input.compose.ccAddresses } : {}),
      })
      .where(and(eq(scheduledEmail.id, input.id), eq(scheduledEmail.bdId, input.bdId), inArray(scheduledEmail.status, [...OPEN_STATUSES]), changeable))
      .returning({ id: scheduledEmail.id });
    if (updated.length && input.compose) await setScheduledAttachments(tx, input.id, input.bdId, input.compose.ownerAuthUid, input.compose.attachments);
    return updated.length ? { ok: true as const } : null;
  });
  return outcome ?? refusalFor(input.id, input.bdId);
}

/** The caller's own row (person and stored recipient), for re-validating the recipient on edit. */
export async function getOwnScheduled(id: string, bdId: string) {
  const [row] = await db.select({ personId: scheduledEmail.personId, toAddress: scheduledEmail.toAddress }).from(scheduledEmail).where(and(eq(scheduledEmail.id, id), eq(scheduledEmail.bdId, bdId)));
  return row ?? null;
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
// An inbound, non-automatic message from this person to this BD, newer than the row's baseline. A merge repoints
// email_message_person to the survivor, so "this person" is the row's person plus every survivor up its merged_into_id chain.
const inboundSinceBaseline = sql`from email_message em join email_message_person emp on emp.email_message_id = em.id
  where em.bd_id = ${scheduledEmail.bdId}
    and emp.person_id in (
      with recursive pbc_chain(pbc_id) as (
        select ${scheduledEmail.personId}::uuid
        union select p.merged_into_id from person p join pbc_chain c on p.id = c.pbc_id where p.merged_into_id is not null)
      select pbc_id from pbc_chain)
    and em.direction = 'inbound' and em.is_automatic = false and em.sent_at > ${scheduledEmail.replyBaselineAt}`;
const repliedSinceBaseline = sql`exists (select 1 ${inboundSinceBaseline})`;
// The newest such reply, for the card that explains why a row is on hold (only evaluated for on_hold rows).
const latestReply = (column: "em.sent_at" | "left(em.body_text, 600)") =>
  sql`case when ${scheduledEmail.status} = 'on_hold' then (select ${sql.raw(column)} ${inboundSinceBaseline} order by em.sent_at desc limit 1) end`;

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

/** A claimed row with what the sender needs besides the row itself: the BD's signature and the files it holds. */
export type ClaimedEmail = ScheduledEmail & { signatureHtml: string | null; attachments: AttachmentRow[] };

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
  const files = await listScheduledAttachments(claimed.map((c) => c.id)); // one read for the whole batch
  return claimed.map((c) => ({ ...c, signatureHtml: byBd.get(c.bdId) ?? null, attachments: files.filter((f) => f.scheduledEmailId === c.id) }));
}

/**
 * Also accepts a row the sweep already declared 'outcome_unknown': the mail did go out, so it must not look unsent, and
 * the follow-up task that sweep opened is closed (best-effort, with its activity). The common path stays ONE statement.
 */
export async function markSent(id: string, gmailMessageId: string): Promise<void> {
  const done = { status: "sent", error: null, gmailMessageId, sentAt: sql`now()`, updatedAt: sql`now()` } as const;
  const sent = await db.update(scheduledEmail).set(done).where(and(eq(scheduledEmail.id, id), eq(scheduledEmail.status, "sending"))).returning({ id: scheduledEmail.id });
  if (sent.length) return;
  await db.transaction(async (tx) => {
    const healed = await tx
      .update(scheduledEmail)
      .set(done)
      .where(and(eq(scheduledEmail.id, id), eq(scheduledEmail.status, "failed"), eq(scheduledEmail.error, "outcome_unknown")))
      .returning({ id: scheduledEmail.id });
    if (healed.length) await bestEffort(tx, "close failure task", (sp) => closeFailureTask(sp, id));
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * One task (plus its task_created activity) per row that JUST turned 'failed', for the owning BD on the contact. Runs in
 * the same transaction as that guarded UPDATE, so it is exactly-once per failure: a row that is no longer 'sending'
 * returns nothing from the UPDATE and gets no task. Set-based (2 inserts for any number of rows). A merged contact's
 * task lands on the live survivor. No audit_log: a failed send is not a consequential admin action.
 */
/**
 * The task step must never undo or block a status change: it runs in a SAVEPOINT, and a failure there (bad FK, odd
 * merge chain, ...) is logged and swallowed while the surrounding transition still commits.
 */
async function bestEffort(tx: Tx, what: string, step: (sp: Tx) => Promise<void>): Promise<void> {
  try {
    await tx.transaction(async (sp) => step(sp as unknown as Tx));
  } catch (err) {
    console.error(`[scheduled-email] ${what} failed`, err);
  }
}

/** Marks the open failure task of this scheduled row done (the mail did go out), with its task_completed activity. */
async function closeFailureTask(tx: Tx, scheduledId: string): Promise<void> {
  const closed = await tx
    .update(task)
    .set({ status: "done", updatedAt: new Date() })
    .where(and(eq(task.status, "open"), sql`${task.description} like ${"%" + failureTaskRef(scheduledId)}`))
    .returning();
  if (!closed.length) return;
  await tx.insert(activity).values(closed.map((t) => buildTaskActivityRow("task_completed", t, t.actorBdId!, { taskId: t.id, taskTitle: t.title })));
  for (const personId of new Set(closed.map((t) => t.personId!))) await recomputePersonStatus(tx, personId);
}

async function openFailureTasks(tx: Tx, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await bestEffort(tx, "open failure task", (sp) => insertFailureTasks(sp, ids));
}

async function insertFailureTasks(tx: Tx, ids: string[]): Promise<void> {
  const rows = await tx
    .select({
      id: scheduledEmail.id, bdId: scheduledEmail.bdId, subject: scheduledEmail.subject, error: scheduledEmail.error,
      personId: sql<string>`coalesce(${person.mergedIntoId}, ${person.id})`, first: person.firstName, last: person.lastName,
    })
    .from(scheduledEmail)
    .innerJoin(person, eq(person.id, scheduledEmail.personId))
    .where(inArray(scheduledEmail.id, ids));
  const now = new Date();
  const fields = rows.map((r) => buildFailureTask({ ...r, personName: [r.first, r.last].filter(Boolean).join(" ") }, now));
  if (!fields.length) return;
  const created = await tx.insert(task).values(fields).returning();
  await tx.insert(activity).values(created.map((t) => buildTaskActivityRow("task_created", t, t.actorBdId!, { taskId: t.id, taskTitle: t.title })));
  for (const personId of new Set(created.map((t) => t.personId!))) await recomputePersonStatus(tx, personId); // task_created is a non-touch type
}

export async function markFailed(id: string, code: string): Promise<void> {
  await db.transaction(async (tx) => {
    const failed = await tx
      .update(scheduledEmail)
      .set({ status: "failed", error: code, updatedAt: sql`now()` })
      .where(and(eq(scheduledEmail.id, id), eq(scheduledEmail.status, "sending")))
      .returning({ id: scheduledEmail.id });
    await openFailureTasks(tx, failed.map((f) => f.id));
  });
}

/** Last-moment cancel of a claimed row (suppressed recipient). Guarded on 'sending': nothing was sent. */
export async function markCancelled(id: string, code: string): Promise<void> {
  await db.update(scheduledEmail).set({ status: "cancelled", error: code, updatedAt: sql`now()` }).where(and(eq(scheduledEmail.id, id), eq(scheduledEmail.status, "sending")));
}

/**
 * Puts claimed rows back to 'scheduled' (guarded on 'sending'). ONLY valid strictly before Gmail is called for them:
 * nothing was sent, so the next run simply retries. Never use after a send attempt (that would allow a double send).
 */
export async function releaseClaimed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.update(scheduledEmail).set({ status: "scheduled", updatedAt: sql`now()` }).where(and(inArray(scheduledEmail.id, ids), eq(scheduledEmail.status, "sending")));
}

/**
 * Cancels the not-yet-sent rows addressed to a just-suppressed address, inside the opt-out's own transaction. Rows already
 * 'sending' are left to the dispatcher's last-moment check (they were claimed before the opt-out was visible).
 */
export async function cancelPendingForAddress(tx: Tx, normalizedAddress: string): Promise<number> {
  const cancelled = await tx
    .update(scheduledEmail)
    .set({ status: "cancelled", error: "recipient_suppressed", updatedAt: sql`now()` })
    .where(and(inArray(scheduledEmail.status, ["scheduled", "on_hold"]), sql`lower(trim(${scheduledEmail.toAddress})) = ${normalizedAddress}`))
    .returning({ id: scheduledEmail.id });
  return cancelled.length;
}

/** A 'sending' row older than STALE_SENDING_MS belongs to a dead run: surfaced as failed (and as a task), never retried. */
export async function sweepStale(): Promise<number> {
  return db.transaction(async (tx) => {
    const swept = await tx
      .update(scheduledEmail)
      .set({ status: "failed", error: "outcome_unknown", updatedAt: sql`now()` })
      .where(and(eq(scheduledEmail.status, "sending"), sql`${scheduledEmail.updatedAt} < now() - make_interval(secs => ${STALE_SENDING_MS / 1000})`))
      .returning({ id: scheduledEmail.id });
    await openFailureTasks(tx, swept.map((r) => r.id));
    return swept.length;
  });
}

const LISTED: ScheduledStatus[] = ["scheduled", "sending", "on_hold", "failed"];
const CANCELLED_VISIBLE_MS = 14 * 24 * 60 * 60_000;

async function listItems(where: ReturnType<typeof and>): Promise<ScheduledItem[]> {
  const rows = await db
    .select({
      row: scheduledEmail,
      first: person.firstName,
      last: person.lastName,
      company: person.company,
      actorName: bd.name,
      replyAt: latestReply("em.sent_at").mapWith((v: unknown) => (v ? new Date(v as string) : null)),
      replyText: latestReply("left(em.body_text, 600)").mapWith((v: unknown) => (v == null ? null : String(v))),
      // Name and size of the files a row holds (never a link: the chips are informational), in the same round trip.
      files: sql`coalesce((select json_agg(json_build_object('filename', a.filename, 'size', a.size_bytes) order by a.created_at, a.id)
        from email_attachment a where a.scheduled_email_id = ${scheduledEmail.id} and a.removed_at is null), '[]'::json)`.mapWith(jsonArray),
      // Names of the OTHER "Para" contacts, in the order they were picked.
      otherRecipients: sql`coalesce((select json_agg(trim(concat_ws(' ', rp.first_name, rp.last_name)) order by array_position(${scheduledEmail.recipientPersonIds}, rp.id))
        from person rp where rp.id = any(${scheduledEmail.recipientPersonIds})), '[]'::json)`.mapWith(jsonArray),
    })
    .from(scheduledEmail)
    .innerJoin(person, eq(person.id, scheduledEmail.personId))
    .innerJoin(bd, eq(bd.id, scheduledEmail.bdId))
    .where(where)
    .orderBy(asc(scheduledEmail.sendAt))
    .limit(100);
  return rows.map(({ row, first, last, company, actorName, replyAt, replyText, files, otherRecipients }) => ({
    id: row.id,
    personId: row.personId,
    personName: [first, last].filter(Boolean).join(" "),
    company,
    toAddress: row.toAddress,
    subject: row.subject,
    body: row.body,
    sendAt: row.sendAt,
    status: row.status as ScheduledStatus,
    error: row.error,
    createdAt: row.createdAt,
    actorName,
    replyAt,
    replyText: replySnippet(replyText),
    cancelledAt: row.status === "cancelled" ? row.updatedAt : null,
    attachments: (files as { filename: string; size: number }[]).map((f) => ({ filename: String(f.filename), size: Number(f.size) })),
    otherRecipients: (otherRecipients as unknown[]).map(String).filter(Boolean),
    ccAddresses: row.ccAddresses,
  }));
}

// The driver hands back a json column parsed; a raw string is parsed here so either shape works.
function jsonArray(value: unknown): unknown[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed : [];
}

/** The "Programados" screen: this BD's rows that are, or may still be, going out. */
export const listOwnScheduled = (bdId: string) => listItems(and(eq(scheduledEmail.bdId, bdId), inArray(scheduledEmail.status, LISTED)));

/** The contact record: this BD's open rows for the person, plus the cancellations of the last two weeks (the timeline line). */
export const listScheduledForPerson = (personId: string, bdId: string) =>
  listItems(
    and(
      eq(scheduledEmail.bdId, bdId),
      eq(scheduledEmail.personId, personId),
      or(
        inArray(scheduledEmail.status, LISTED),
        and(eq(scheduledEmail.status, "cancelled"), gt(scheduledEmail.updatedAt, new Date(Date.now() - CANCELLED_VISIBLE_MS))),
      ),
    ),
  );

export async function isGmailConnected(bdId: string): Promise<boolean> {
  const [row] = await db.select({ status: emailAccount.status }).from(emailAccount).where(eq(emailAccount.bdId, bdId));
  return row?.status === "connected";
}

/**
 * "Enviar ahora" / "Enviar igual": the BD decided, so the row is due immediately; a held row's reply baseline restarts
 * (the reply that paused it must not pause it again). Same ownership, lock window and cap rules as an edit.
 */
export async function sendScheduledNow(input: { id: string; bdId: string }): Promise<EditResult> {
  const [row] = await db.select({ status: scheduledEmail.status }).from(scheduledEmail).where(and(eq(scheduledEmail.id, input.id), eq(scheduledEmail.bdId, input.bdId)));
  if (!row) return { ok: false, reason: "not_found" };
  const outcome = await db.transaction(async (tx) => {
    if (row.status === "failed") {
      await lockBd(tx, input.bdId); // returning to 'scheduled' adds to the pending count
      if ((await countPending(input.bdId, tx)) >= MAX_PENDING) return { ok: false as const, reason: "schedule_cap_reached" as const };
    }
    const updated = await tx
      .update(scheduledEmail)
      // Only "Enviar igual" (a held row) forgives the reply that paused it; any other row keeps its baseline so holdReplied still guards it.
      .set({ status: "scheduled", sendAt: sql`now()`, error: null, updatedAt: sql`now()`, replyBaselineAt: sql`case when ${scheduledEmail.status} = 'on_hold' then now() else ${scheduledEmail.replyBaselineAt} end` })
      .where(and(eq(scheduledEmail.id, input.id), eq(scheduledEmail.bdId, input.bdId), inArray(scheduledEmail.status, [...OPEN_STATUSES]), changeable))
      .returning({ id: scheduledEmail.id });
    return updated.length ? { ok: true as const } : null;
  });
  return outcome ?? refusalFor(input.id, input.bdId);
}
