/**
 * DB-backed tests for reply handling (task 10.5) against a real, local scratch database: the move to `replied`, the
 * reminder withdrawal, the audit rows, idempotence, and the no-op against SEEDED members that have no send time (the
 * state production is in after PR 6b: rows exist, none has been sent). Messages come from the real parse + classify.
 * Opt-in and fail-closed: `npm run test:db`, DATABASE_URL naming a `*_e2e` database on loopback.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const SENT = new Date("2026-10-08T13:00:00Z");
const NOW = new Date("2026-10-15T14:00:00Z");
const at = (days: number) => SENT.getTime() + days * 86_400_000;
const bdIds: string[] = [];
const accountIds: string[] = [];
const personIds: string[] = [];

let sequences = 0;
async function mkSequence() {
  const n = ++sequences;
  const { db } = await import("@/db");
  const { bd, emailAccount, sequence } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: `ZZ Replies ${run} ${n}`, email: `zz-rep-${run}-${n}@example.test` }).returning();
  bdIds.push(b.id);
  const [acc] = await db.insert(emailAccount).values({ bdId: b.id, emailAddress: `zz-rep-sender-${run}-${n}@example.test`, lastSyncedAt: NOW }).returning();
  accountIds.push(acc.id);
  const [s] = await db.insert(sequence).values({ name: `zz-${run}-${n}`, ownerBdId: b.id, emailAccountId: acc.id, dailySendCap: 5, schedule: {} }).returning();
  return { bdId: b.id, bdEmail: acc.emailAddress, sequenceId: s.id };
}
type Seq = Awaited<ReturnType<typeof mkSequence>>;

async function mkMember(s: Seq, name: string, over: { state: string; sentAt?: Date | null; reminder?: "none" | "pending" | "approved" }) {
  const { db } = await import("@/db");
  const { person, sequenceDraft, sequenceMember } = await import("@/db/schema");
  const email = `zz-rep-${name}-${run}-${s.sequenceId.slice(0, 8)}@example.test`;
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo" }).returning();
  personIds.push(p.id);
  const sentAt = over.sentAt === undefined ? SENT : over.sentAt;
  const [m] = await db
    .insert(sequenceMember)
    .values({ sequenceId: s.sequenceId, personId: p.id, state: over.state, sentAt, reminderDueAt: over.reminder && over.reminder !== "none" ? new Date(at(3)) : null })
    .returning();
  await db.insert(sequenceDraft).values({ sequenceMemberId: m.id, step: 1, subject: "s1", body: "b1", approvedAt: SENT });
  if (over.reminder && over.reminder !== "none") {
    await db.insert(sequenceDraft).values({ sequenceMemberId: m.id, step: 2, subject: "s2", body: "b2", approvedAt: over.reminder === "approved" ? SENT : null, scheduledFor: over.reminder === "approved" ? new Date(at(3)) : null });
  }
  return { memberId: m.id, personId: p.id, email };
}

async function inbound(s: Seq, person: { personId: string; email: string }, o: { days: number; auto?: boolean; gid: string }) {
  const { classifyGmailMessage } = await import("@/lib/gmail/classify");
  const { parseGmailMessage } = await import("@/lib/gmail/parseMessage");
  const message = parseGmailMessage({
    id: o.gid, threadId: `t-${run}`, internalDate: String(at(o.days)),
    payload: { mimeType: "text/plain", headers: [{ name: "From", value: person.email }, { name: "To", value: s.bdEmail }, { name: "Subject", value: "Re: hello" }, ...(o.auto ? [{ name: "Auto-Submitted", value: "auto-replied" }] : [])], body: { data: Buffer.from("hi").toString("base64url") } },
  });
  return classifyGmailMessage({ message, bdEmail: s.bdEmail, knownPersons: [{ personId: person.personId, emailNormalized: person.email, confidence: "exact" }], neverLogRules: [] });
}

async function apply(s: Seq, messages: Awaited<ReturnType<typeof inbound>>[]) {
  const { applySequenceReplies } = await import("@/lib/sequences/applyReplies");
  const { liveReplyPorts } = await import("@/lib/sequences/replyQueries");
  return applySequenceReplies(messages, liveReplyPorts);
}

async function memberRow(id: string) {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceMember).where(eq(sequenceMember.id, id)))[0]!;
}
async function step2Draft(memberId: string) {
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceDraft).where(and(eq(sequenceDraft.sequenceMemberId, memberId), eq(sequenceDraft.step, 2))))[0];
}
/** A system-inferred move has no actor, so it writes NO audit_log row (actor_bd_id is NOT NULL and the mailbox owner decided nothing). */
async function auditCount(memberId: string) {
  const { db } = await import("@/db");
  const { auditLog } = await import("@/db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const rows = await db.select().from(auditLog).where(and(sql`${auditLog.metadata}->>'memberId' = ${memberId}`));
  return rows.length;
}
async function queueRows() {
  const { db } = await import("@/db");
  const { followUpQueueItem } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  return (await db.select().from(followUpQueueItem).where(inArray(followUpQueueItem.personId, personIds))).length;
}

before(async () => {
  await import("@/db");
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, person, sequence } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (bdIds.length) await db.delete(sequence).where(inArray(sequence.ownerBdId, bdIds));
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
  if (accountIds.length) await db.delete(emailAccount).where(inArray(emailAccount.id, accountIds));
  if (bdIds.length) await db.delete(bd).where(inArray(bd.id, bdIds));
});

test("SEEDED members that were never sent (no sent_at) are a no-op: a reply from them changes nothing and writes nothing", async () => {
  const s = await mkSequence();
  const drafted = await mkMember(s, "drafted", { state: "drafted", sentAt: null });
  const approved = await mkMember(s, "approved", { state: "approved", sentAt: null });
  const result = await apply(s, [await inbound(s, drafted, { days: 1, gid: `g-d-${run}` }), await inbound(s, approved, { days: 1, gid: `g-a-${run}` })]);
  assert.deepEqual(result, { replied: 0 });
  for (const m of [drafted, approved]) {
    const row = await memberRow(m.memberId);
    assert.equal(row.repliedAt, null);
    assert.notEqual(row.state, "replied");
    assert.equal(await auditCount(m.memberId), 0);
  }
});

test("a genuine reply after the send moves sent -> replied, withdraws an APPROVED reminder, and writes no queue row", async () => {
  const s = await mkSequence();
  const m = await mkMember(s, "approvedreminder", { state: "sent", reminder: "approved" });
  const { listReleaseCandidates } = await import("@/lib/sequences/releaseQueries");
  assert.ok((await listReleaseCandidates(NOW)).some((c) => c.id === m.memberId), "precondition: the reminder was due for release");

  assert.deepEqual(await apply(s, [await inbound(s, m, { days: 2, gid: `g1-${run}` })]), { replied: 1 });

  const row = await memberRow(m.memberId);
  assert.equal(row.state, "replied");
  assert.equal(row.repliedAt?.toISOString(), new Date(at(2)).toISOString());
  assert.equal(row.reminderDueAt, null);
  const draft = await step2Draft(m.memberId);
  assert.ok(draft, "the reminder text is kept as history");
  assert.equal(draft.approvedAt, null);
  assert.equal(draft.scheduledFor, null);
  assert.equal(await auditCount(m.memberId), 0, "no audit row, no invented actor");
  assert.equal(await queueRows(), 0, "never writes follow_up_queue_item");
  assert.ok(!(await listReleaseCandidates(NOW)).some((c) => c.id === m.memberId), "the runner can no longer see the reminder");
});

test("a PENDING reminder (due, not approved) is withdrawn too", async () => {
  const s = await mkSequence();
  const m = await mkMember(s, "pendingreminder", { state: "sent", reminder: "pending" });
  await apply(s, [await inbound(s, m, { days: 2, gid: `g2-${run}` })]);
  assert.equal((await memberRow(m.memberId)).reminderDueAt, null);
  assert.equal((await memberRow(m.memberId)).state, "replied");
});

test("no_reply -> replied, and an auto-reply followed by a human reply sets replied_at to the SECOND message", async () => {
  const s = await mkSequence();
  const m = await mkMember(s, "noreply", { state: "no_reply" });
  const auto = await inbound(s, m, { days: 1, gid: `g-auto-${run}`, auto: true });
  assert.deepEqual(await apply(s, [auto]), { replied: 0 });
  assert.equal((await memberRow(m.memberId)).state, "no_reply");
  assert.deepEqual(await apply(s, [auto, await inbound(s, m, { days: 4, gid: `g-human-${run}` })]), { replied: 1 });
  const row = await memberRow(m.memberId);
  assert.equal(row.state, "replied");
  assert.equal(row.repliedAt?.toISOString(), new Date(at(4)).toISOString());
});

test("a message before the send does not count, and a replay after the reply changes nothing (idempotent)", async () => {
  const s = await mkSequence();
  const m = await mkMember(s, "idem", { state: "sent" });
  assert.deepEqual(await apply(s, [await inbound(s, m, { days: -1, gid: `g-old-${run}` })]), { replied: 0 });
  const reply = await inbound(s, m, { days: 2, gid: `g-r-${run}` });
  assert.deepEqual(await apply(s, [reply]), { replied: 1 });
  assert.deepEqual(await apply(s, [reply, await inbound(s, m, { days: 6, gid: `g-later-${run}` })]), { replied: 0 });
  const row = await memberRow(m.memberId);
  assert.equal(row.repliedAt?.toISOString(), new Date(at(2)).toISOString());
  assert.equal(await auditCount(m.memberId), 0, "no audit row, no invented actor");
});

test("CROSS-BD by design: mail synced under one BD's mailbox moves a member in ANOTHER BD's Sequence", async () => {
  const mailboxOwner = await mkSequence(); // the BD whose sync saw the mail
  const other = await mkSequence(); // the BD that owns the Sequence
  const m = await mkMember(other, "crossbd", { state: "sent" });
  assert.deepEqual(await apply(mailboxOwner, [await inbound(mailboxOwner, m, { days: 2, gid: `g-x-${run}` })]), { replied: 1 });
  assert.equal((await memberRow(m.memberId)).state, "replied");
});

test("a row lock held by someone else fails the move fast (lock_timeout) instead of eating the sync's budget, and moves nothing", async () => {
  const s = await mkSequence();
  const m = await mkMember(s, "locked", { state: "sent" });
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { REPLY_LOCK_TIMEOUT } = await import("@/lib/sequences/replyQueries");
  assert.equal(REPLY_LOCK_TIMEOUT, "5s");
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => (locked = resolve));
  const holder = db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from sequence_member where id = ${m.memberId}::uuid for update`);
    locked();
    await held;
  });
  await lockTaken;
  const started = Date.now();
  await assert.rejects(apply(s, [await inbound(s, m, { days: 2, gid: `g-l-${run}` })]), /lock timeout/i);
  assert.ok(Date.now() - started < 8000, "failed fast");
  release();
  await holder;
  assert.equal((await memberRow(m.memberId)).state, "sent");
});
