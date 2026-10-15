/**
 * DB-backed tests for the release runner core against a real (local, scratch) database: the at-most-once claim under
 * genuinely concurrent runs, a pending claim that is never resent, the cap counting only recorded sends, holds written
 * and deferred members left untouched, and the reminder path. The Gmail send is a counting fake: nothing here can send
 * an email. Opt-in and fail-closed: `npm run test:db`, DATABASE_URL naming a `*_e2e` database on loopback.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const NOW = new Date("2026-10-15T14:00:00Z"); // 10:00 Miami (EDT)
const DUE = new Date("2026-10-15T13:00:00Z");
const bdIds: string[] = [];
const accountIds: string[] = [];
const personIds: string[] = [];
const suppressed: string[] = [];

async function mkAccount(label: string, cap = 5) {
  const { db } = await import("@/db");
  const { bd, emailAccount, sequence } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: `ZZ Release ${label}`, email: `zz-rel-${label}-${run}@example.test` }).returning();
  bdIds.push(b.id);
  const [acc] = await db.insert(emailAccount).values({ bdId: b.id, emailAddress: `zz-rel-sender-${label}-${run}@example.test`, lastSyncedAt: NOW }).returning();
  accountIds.push(acc.id);
  const [s] = await db.insert(sequence).values({ name: `zz-${run}-${label}`, ownerBdId: b.id, emailAccountId: acc.id, dailySendCap: cap, schedule: {} }).returning();
  return { bdId: b.id, accountId: acc.id, sequenceId: s.id };
}
type Acct = Awaited<ReturnType<typeof mkAccount>>;

async function footedBody(country: "us" | "latam" = "us") {
  const { appendFooter } = await import("@/lib/sequences/complianceFooter");
  const { COMPLIANCE_CONFIG } = await import("@/lib/sequences/config");
  const { buildUnsubscribeUrl, generateUnsubscribeToken } = await import("@/lib/sequences/unsubscribeToken");
  const r = appendFooter("Hello there", COMPLIANCE_CONFIG, country, buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken()));
  assert.equal(r.status, "ok");
  return r.status === "ok" ? r.body : "";
}

async function mkMember(a: Acct, name: string, over: { state?: string; step?: 1 | 2; country?: string; email?: string; reminderDueAt?: Date; approvedAt?: Date } = {}) {
  const { db } = await import("@/db");
  const { person, sequenceDraft, sequenceMember } = await import("@/db/schema");
  const email = over.email ?? `zz-rel-${name}-${run}@example.test`;
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", country: over.country ?? "United States" }).returning();
  personIds.push(p.id);
  const step = over.step ?? 1;
  const [m] = await db
    .insert(sequenceMember)
    .values({ sequenceId: a.sequenceId, personId: p.id, state: over.state ?? "approved", ...(step === 2 ? { sentAt: new Date("2026-10-08T13:00:00Z"), reminderDueAt: over.reminderDueAt ?? DUE } : {}) })
    .returning();
  await db.insert(sequenceDraft).values({ sequenceMemberId: m.id, step, subject: `Hi ${name}`, body: await footedBody(), approvedAt: over.approvedAt ?? new Date("2026-10-14T20:00:00Z"), scheduledFor: DUE });
  return { memberId: m.id, personId: p.id, email };
}

async function insertClaim(memberId: string, a: Acct, v: { outcome: string; step?: number; date?: string; rfc?: string; thread?: string; claimedAt?: Date }) {
  const { db } = await import("@/db");
  const { sequenceSendClaim } = await import("@/db/schema");
  await db.insert(sequenceSendClaim).values({
    sequenceMemberId: memberId, step: v.step ?? 1, sendingAccountId: a.accountId, outcome: v.outcome, claimedAt: v.claimedAt ?? NOW, miamiSendDate: v.date ?? null,
    rfcMessageId: v.rfc ?? null, gmailThreadId: v.thread ?? null, gmailMessageId: v.thread ? "g-prev" : null,
  });
}

async function memberRow(memberId: string) {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceMember).where(eq(sequenceMember.id, memberId)))[0];
}
async function claimsOf(memberId: string) {
  const { db } = await import("@/db");
  const { sequenceSendClaim } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(sequenceSendClaim).where(eq(sequenceSendClaim.sequenceMemberId, memberId));
}

/** The real ports, scoped to this test's accounts, with a counting fake instead of Gmail and a fake reminder generator. */
async function portsFor(accounts: Acct[], opts: { latencyMs?: number; barrier?: () => Promise<void>; sendError?: () => Error | null } = {}) {
  const { liveRunnerPorts } = await import("@/lib/sequences/releaseQueries");
  const sends: { to: string; reply?: { threadId: string }; extraHeaders: string[]; metadata: Record<string, unknown> }[] = [];
  const reminders: string[] = [];
  const ids = new Set(accounts.map((a) => a.accountId));
  const ports = {
    ...liveRunnerPorts,
    now: () => NOW,
    load: async (now: Date) => {
      const loaded = await liveRunnerPorts.load(now);
      await opts.barrier?.();
      return { ...loaded, candidates: loaded.candidates.filter((c) => ids.has(c.accountId)) };
    },
    send: async (_c: unknown, m: { to: string; reply?: { threadId: string }; extraHeaders: string[]; activityMetadata: Record<string, unknown> }) => {
      sends.push({ to: m.to, reply: m.reply, extraHeaders: m.extraHeaders, metadata: m.activityMetadata });
      const err = opts.sendError?.();
      if (err) throw err;
      await new Promise((r) => setTimeout(r, opts.latencyMs ?? 25));
      const n = sends.length;
      return { messageId: `g-${run}-${n}-${m.to}`, threadId: `t-${run}-${n}` };
    },
    draftReminder: async (c: { id: string }) => void reminders.push(c.id),
  };
  return { ports, sends, reminders };
}

before(async () => {
  await import("@/db");
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, emailSuppression, person, sequence } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (bdIds.length) await db.delete(sequence).where(inArray(sequence.ownerBdId, bdIds));
  if (suppressed.length) await db.delete(emailSuppression).where(inArray(emailSuppression.value, suppressed));
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
  if (accountIds.length) await db.delete(emailAccount).where(inArray(emailAccount.id, accountIds));
  if (bdIds.length) await db.delete(bd).where(inArray(bd.id, bdIds));
});

test("two CONCURRENT runs with one approved due member send exactly one email (both pass the checks; only the claim arbitrates)", async () => {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const a = await mkAccount("race");
  const m = await mkMember(a, "race");
  // Barrier: neither run may claim until BOTH have read the member as claimable, so no pre-check can mask the race.
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const barrier = async () => {
    if (++arrived >= 2) open();
    await gate;
  };
  const { ports, sends, reminders } = await portsFor([a], { barrier });
  const [r1, r2] = await Promise.all([runSequenceRelease(ports), runSequenceRelease(ports)]);

  assert.equal(sends.length, 1, "exactly one email");
  assert.equal(r1.released + r2.released, 1);
  const claims = await claimsOf(m.memberId);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].outcome, "sent");
  assert.equal(claims[0].miamiSendDate, "2026-10-15");
  const row = await memberRow(m.memberId);
  assert.equal(row.state, "sent");
  assert.equal(row.holdReason, null, "no stale hold survives the send");
  assert.equal(row.sentAt?.toISOString(), NOW.toISOString());
  assert.equal(row.reminderDueAt?.toISOString(), "2026-10-22T13:00:00.000Z", "7 Miami days after the actual send, at 09:00");
  assert.deepEqual(reminders, [m.memberId]);
  assert.deepEqual(sends[0].metadata, { sequenceId: a.sequenceId, sequenceMemberId: m.memberId, step: 1 });
  assert.match(sends[0].extraHeaders[0], /^List-Unsubscribe: <https:\/\/crm\.example\.test\/api\/unsubscribe\?t=/);
});

test("many concurrent runs over several members: every member is sent exactly once", async () => {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const a = await mkAccount("many", 15);
  const members = await Promise.all(["a", "b", "c", "d", "e"].map((n) => mkMember(a, `many-${n}`)));
  const { ports, sends } = await portsFor([a], { latencyMs: 5 });
  await Promise.all([runSequenceRelease(ports), runSequenceRelease(ports), runSequenceRelease(ports)]);
  assert.equal(sends.length, 5);
  assert.deepEqual(new Set(sends.map((s) => s.to)), new Set(members.map((m) => m.email)));
  for (const m of members) assert.equal((await claimsOf(m.memberId)).filter((c) => c.outcome === "sent").length, 1);
});

test("a pending claim (crash: outcome unknown) is NOT re-sent, is flagged manual_check, and stays pending across runs", async () => {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const a = await mkAccount("pending");
  const m = await mkMember(a, "pending");
  await insertClaim(m.memberId, a, { outcome: "pending" });
  const { ports, sends } = await portsFor([a]);
  const first = await runSequenceRelease(ports);
  const second = await runSequenceRelease(ports);
  assert.deepEqual(first, { released: 0, held: 1, deferred: 0, failed: 0 });
  assert.equal(second.released, 0);
  assert.equal(sends.length, 0);
  const row = await memberRow(m.memberId);
  assert.equal(row.holdReason, "manual_check");
  assert.equal(row.state, "approved");
  assert.deepEqual((await claimsOf(m.memberId)).map((c) => c.outcome), ["pending"]);
});

test("a failed claim stays as history and the member is claimed again and sent", async () => {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const a = await mkAccount("retry");
  const m = await mkMember(a, "retry");
  await insertClaim(m.memberId, a, { outcome: "failed" });
  const { ports, sends } = await portsFor([a]);
  assert.equal((await runSequenceRelease(ports)).released, 1);
  assert.equal(sends.length, 1);
  assert.deepEqual((await claimsOf(m.memberId)).map((c) => c.outcome).sort(), ["failed", "sent"]);
});

test("the cap counts recorded sends AND today's pending claims; failed claims and yesterday's pending do not; deferred members get no hold", async () => {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const a = await mkAccount("cap", 4);
  const done = await mkMember(a, "cap-done", { state: "sent" });
  await insertClaim(done.memberId, a, { outcome: "sent", date: "2026-10-15" });
  const yesterday = await mkMember(a, "cap-yesterday", { state: "sent" });
  await insertClaim(yesterday.memberId, a, { outcome: "sent", date: "2026-10-14" });
  const oldPending = await mkMember(a, "cap-oldpending", { state: "sent" });
  await insertClaim(oldPending.memberId, a, { outcome: "pending", claimedAt: new Date("2026-10-14T15:00:00Z") });
  const failedBefore = await mkMember(a, "cap-failed");
  await insertClaim(failedBefore.memberId, a, { outcome: "failed" });
  const stuck = await mkMember(a, "cap-stuck");
  await insertClaim(stuck.memberId, a, { outcome: "pending" });
  const w = await mkMember(a, "cap-w");
  const v = await mkMember(a, "cap-v");
  const { ports, sends } = await portsFor([a]);
  const { countSentToday } = await import("@/lib/sequences/releaseQueries");
  // Tradeoff, on purpose: a pending claim whose email may or may not have left eats a slot for that Miami day (fails safe).
  assert.equal((await countSentToday(NOW)).get(a.accountId), 2, "today's recorded send + today's pending claim");
  const summary = await runSequenceRelease(ports);
  assert.equal(sends.length, 2, "cap 4 minus 2");
  assert.deepEqual(summary, { released: 2, held: 1, deferred: 1, failed: 0 });
  const deferred = [failedBefore, w, v].filter((x) => !sends.some((s) => s.to === x.email));
  assert.equal(deferred.length, 1);
  assert.equal((await memberRow(deferred[0].memberId)).holdReason, null, "a deferred member is left exactly as it was");
  assert.equal((await memberRow(deferred[0].memberId)).state, "approved");
  assert.equal((await memberRow(stuck.memberId)).holdReason, "manual_check");
});

test("a Gmail 503 may have been accepted: the claim stays pending, the member is manual_check, and a second run does NOT resend", async () => {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const { GmailSendError } = await import("@/lib/gmail/errors");
  const a = await mkAccount("e503");
  const m = await mkMember(a, "e503");
  let fail = true;
  const { ports, sends } = await portsFor([a], { sendError: () => (fail ? new GmailSendError("send_failed", "Gmail send failed: 503", undefined, 503) : null) });
  assert.deepEqual(await runSequenceRelease(ports), { released: 0, held: 0, deferred: 0, failed: 1 });
  fail = false;
  const second = await runSequenceRelease(ports);
  assert.equal(second.released, 0);
  assert.equal(sends.length, 1, "Gmail was called exactly once across both runs");
  assert.deepEqual((await claimsOf(m.memberId)).map((c) => c.outcome), ["pending"]);
  const row = await memberRow(m.memberId);
  assert.equal(row.holdReason, "manual_check");
  assert.equal(row.state, "approved");
});

test("a Gmail 400 is definitive: the claim is failed and the member is retried by the next run", async () => {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const { GmailSendError } = await import("@/lib/gmail/errors");
  const a = await mkAccount("e400");
  const m = await mkMember(a, "e400");
  let fail = true;
  const { ports, sends } = await portsFor([a], { sendError: () => (fail ? new GmailSendError("send_failed", "Gmail send failed: 400", undefined, 400) : null) });
  assert.equal((await runSequenceRelease(ports)).failed, 1);
  assert.equal((await memberRow(m.memberId)).holdReason, "send_failed");
  fail = false;
  assert.equal((await runSequenceRelease(ports)).released, 1);
  assert.equal(sends.length, 2);
  assert.deepEqual((await claimsOf(m.memberId)).map((c) => c.outcome).sort(), ["failed", "sent"]);
  assert.equal((await memberRow(m.memberId)).holdReason, null);
});

test("the claim itself enforces the state, independent of preSendChecks and of what the caller says", async () => {
  const { claimStep, listReleaseCandidates } = await import("@/lib/sequences/releaseQueries");
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const a = await mkAccount("claimstate");
  const m = await mkMember(a, "claimstate");
  const [cand] = (await listReleaseCandidates(NOW)).filter((c) => c.id === m.memberId);
  await db.update(sequenceMember).set({ state: "drafted" }).where(eq(sequenceMember.id, m.memberId));
  assert.equal(await claimStep({ ...cand, memberState: "drafted" }), null, "a drafted member can never be claimed, even if the caller says it is drafted");
  assert.equal(await claimStep({ ...cand, memberState: "approved" }), null);
  assert.deepEqual(await claimsOf(m.memberId), []);
  await db.update(sequenceMember).set({ state: "approved" }).where(eq(sequenceMember.id, m.memberId));
  assert.ok(await claimStep(cand), "approved step 1 is claimable");
});

test("a step 2 claim needs replied_at null AND a sent step 1 claim", async () => {
  const { claimStep, listReleaseCandidates } = await import("@/lib/sequences/releaseQueries");
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const a = await mkAccount("claim2");
  const noStep1 = await mkMember(a, "claim2-nostep1", { state: "sent", step: 2 });
  const replied = await mkMember(a, "claim2-replied", { state: "sent", step: 2 });
  await insertClaim(replied.memberId, a, { outcome: "sent", step: 1, date: "2026-10-08", rfc: "<r@x.test>", thread: "t-r" });
  await db.update(sequenceMember).set({ repliedAt: new Date("2026-10-10T10:00:00Z") }).where(eq(sequenceMember.id, replied.memberId));
  const good = await mkMember(a, "claim2-good", { state: "sent", step: 2 });
  await insertClaim(good.memberId, a, { outcome: "sent", step: 1, date: "2026-10-08", rfc: "<g@x.test>", thread: "t-g" });
  const byId = new Map((await listReleaseCandidates(NOW)).map((c) => [c.id, c]));
  assert.equal(await claimStep(byId.get(noStep1.memberId)!), null);
  assert.equal(await claimStep({ ...byId.get(replied.memberId)! }), null);
  assert.ok(await claimStep(byId.get(good.memberId)!));
});

/** An email_message row (and its person link) as the sync stores it; `sentAt` is relative to step 1 going out on 2026-10-08T13:00Z. */
async function insertMail(a: Acct, personId: string, email: string, o: { direction?: "inbound" | "outbound"; auto?: boolean; confidence?: string; sentAt: string }) {
  const { db } = await import("@/db");
  const { emailMessage, emailMessagePerson } = await import("@/db/schema");
  const [row] = await db.insert(emailMessage).values({
    bdId: a.bdId, gmailMessageId: `g-${run}-${Math.random().toString(36).slice(2)}`, gmailThreadId: `t-${run}`, direction: o.direction ?? "inbound",
    personId, fromAddress: email, matchedEmail: email, matchConfidence: o.confidence ?? "exact", isAutomatic: o.auto ?? false, sentAt: new Date(o.sentAt),
  }).returning();
  await db.insert(emailMessagePerson).values({ emailMessageId: row.id, personId, matchedEmail: email, matchConfidence: o.confidence ?? "exact" });
}

test("a reminder is HELD when email_message shows a genuine post-send reply, although replied_at was never written (the hook failed)", async () => {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const { claimStep, listReleaseCandidates } = await import("@/lib/sequences/releaseQueries");
  const a = await mkAccount("srcoftruth");
  const answered = await mkMember(a, "sot-answered", { state: "sent", step: 2 });
  const control = { auto: await mkMember(a, "sot-auto", { state: "sent", step: 2 }), thread: await mkMember(a, "sot-thread", { state: "sent", step: 2 }), before: await mkMember(a, "sot-before", { state: "sent", step: 2 }), out: await mkMember(a, "sot-out", { state: "sent", step: 2 }) };
  for (const [i, m] of [answered, ...Object.values(control)].entries()) await insertClaim(m.memberId, a, { outcome: "sent", step: 1, date: "2026-10-08", rfc: `<s${i}@x.test>`, thread: `t-s${i}` });
  await insertMail(a, answered.personId, answered.email, { sentAt: "2026-10-09T09:00:00Z" });
  await insertMail(a, control.auto.personId, control.auto.email, { sentAt: "2026-10-09T09:00:00Z", auto: true });
  await insertMail(a, control.thread.personId, control.thread.email, { sentAt: "2026-10-09T09:00:00Z", confidence: "thread" });
  await insertMail(a, control.before.personId, control.before.email, { sentAt: "2026-10-07T09:00:00Z" });
  await insertMail(a, control.out.personId, control.out.email, { sentAt: "2026-10-09T09:00:00Z", direction: "outbound" });
  assert.equal((await memberRow(answered.memberId)).repliedAt, null, "precondition: the derived column was never written");

  const byId = new Map((await listReleaseCandidates(NOW)).map((c) => [c.id, c]));
  assert.ok(byId.get(answered.memberId)!.inboundReplyAt, "the candidate read carries the source-of-truth fact");
  for (const m of Object.values(control)) assert.equal(byId.get(m.memberId)!.inboundReplyAt, null, "automatic, thread-attributed, pre-send and outbound mail are not replies");
  // The claim is independent of preSendChecks: a forged candidate that says "no reply" still cannot claim the answered member.
  assert.equal(await claimStep({ ...byId.get(answered.memberId)!, inboundReplyAt: null }), null);

  const { ports, sends } = await portsFor([a]);
  assert.deepEqual(await runSequenceRelease(ports), { released: 4, held: 1, deferred: 0, failed: 0 });
  assert.ok(!sends.some((s) => s.to === answered.email));
  assert.equal((await memberRow(answered.memberId)).holdReason, "replied");
});

test("holds are persisted: an unmapped market and a suppressed address are not sent and say why", async () => {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const { insertSuppression } = await import("@/lib/sequences/suppressionQueries");
  const a = await mkAccount("holds");
  const spain = await mkMember(a, "holds-spain", { country: "Spain" });
  const optOut = await mkMember(a, "holds-optout");
  suppressed.push(optOut.email);
  await insertSuppression({ kind: "address", rawValue: optOut.email, source: "manual" });
  const fine = await mkMember(a, "holds-fine");
  const { ports, sends } = await portsFor([a]);
  assert.deepEqual(await runSequenceRelease(ports), { released: 1, held: 2, deferred: 0, failed: 0 });
  assert.deepEqual(sends.map((s) => s.to), [fine.email]);
  assert.equal((await memberRow(spain.memberId)).holdReason, "unmapped_market");
  assert.equal((await memberRow(optOut.memberId)).holdReason, "suppressed");
  assert.deepEqual(await claimsOf(spain.memberId), []);
});

test("the reminder: sent threaded on step 1's stored Message-ID, member -> no_reply, no further reminder drafted", async () => {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const a = await mkAccount("reminder");
  const m = await mkMember(a, "reminder", { state: "sent", step: 2 });
  await insertClaim(m.memberId, a, { outcome: "sent", step: 1, date: "2026-10-08", rfc: "<step1@mail.example.test>", thread: "t-step1" });
  const { ports, sends, reminders } = await portsFor([a]);
  assert.equal((await runSequenceRelease(ports)).released, 1);
  assert.deepEqual(sends[0].reply?.threadId, "t-step1");
  assert.equal((await memberRow(m.memberId)).state, "no_reply");
  assert.deepEqual(reminders, []);
  assert.deepEqual((await claimsOf(m.memberId)).map((c) => `${c.step}:${c.outcome}`).sort(), ["1:sent", "2:sent"]);
});

test("a reminder with no stored Message-ID for step 1 is held with no_thread_headers, never sent unthreaded", async () => {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const a = await mkAccount("nothread");
  const m = await mkMember(a, "nothread", { state: "sent", step: 2 });
  await insertClaim(m.memberId, a, { outcome: "sent", step: 1, date: "2026-10-08", thread: "t-step1" });
  const { ports, sends } = await portsFor([a]);
  assert.deepEqual(await runSequenceRelease(ports), { released: 0, held: 1, deferred: 0, failed: 0 });
  assert.equal(sends.length, 0);
  assert.equal((await memberRow(m.memberId)).holdReason, "no_thread_headers");
});

test("members of the seeded shape (state drafted, nothing sent) are never touched by a run", async () => {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const a = await mkAccount("inert");
  const m = await mkMember(a, "inert", { state: "drafted" });
  const { ports, sends } = await portsFor([a]);
  assert.deepEqual(await runSequenceRelease(ports), { released: 0, held: 0, deferred: 0, failed: 0 });
  assert.equal(sends.length, 0);
  assert.equal((await memberRow(m.memberId)).state, "drafted");
  assert.deepEqual(await claimsOf(m.memberId), []);
});

test("the claim re-reads the draft: text edited after the candidate read, or re-approved, is NOT claimed (the old text is never sent)", async () => {
  const { claimStep, listReleaseCandidates } = await import("@/lib/sequences/releaseQueries");
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const a = await mkAccount("stale");
  const edited = await mkMember(a, "stale-edited");
  const reapproved = await mkMember(a, "stale-reapproved");
  const untouched = await mkMember(a, "stale-untouched");
  const byId = new Map((await listReleaseCandidates(NOW)).map((c) => [c.id, c]));
  await db.update(sequenceDraft).set({ subject: "A different subject" }).where(eq(sequenceDraft.sequenceMemberId, edited.memberId));
  await db.update(sequenceDraft).set({ approvedAt: new Date("2026-10-15T13:30:00Z") }).where(eq(sequenceDraft.sequenceMemberId, reapproved.memberId));
  assert.equal(await claimStep(byId.get(edited.memberId)!), null, "subject changed since the read");
  assert.equal(await claimStep(byId.get(reapproved.memberId)!), null, "approved_at changed since the read");
  assert.ok(await claimStep(byId.get(untouched.memberId)!), "an unchanged draft is still claimable (no ms/us precision mismatch)");
  await db.update(sequenceDraft).set({ body: "Edited body" }).where(eq(sequenceDraft.sequenceMemberId, untouched.memberId));
  assert.deepEqual(await claimsOf(edited.memberId), []);
});

test("the cap cuts by the release instant (reminderReleaseAt), and says so when it cuts", async () => {
  const { loadReleaseCandidates } = await import("@/lib/sequences/releaseQueries");
  const a = await mkAccount("order");
  // Raw reminder_due_at order is A < B; release order is B < A (A was approved late, so it waits for the next 09:00 window).
  const early = { state: "sent", step: 2 as const, reminderDueAt: new Date("2026-10-10T13:00:00Z"), approvedAt: new Date("2026-10-12T20:00:00Z") };
  const late = { state: "sent", step: 2 as const, reminderDueAt: new Date("2026-10-11T13:00:00Z"), approvedAt: new Date("2026-10-09T20:00:00Z") };
  const ma = await mkMember(a, "order-a", early);
  const mb = await mkMember(a, "order-b", late);
  const one = await loadReleaseCandidates(NOW, 1);
  assert.deepEqual(one.candidates.map((c) => c.id), [mb.memberId], "B releases first");
  assert.equal(one.truncated, true);
  const many = await loadReleaseCandidates(NOW, 1000);
  assert.equal(many.truncated, false);
  const mine = many.candidates.filter((c) => c.id === ma.memberId || c.id === mb.memberId);
  assert.equal(mine.find((c) => c.id === ma.memberId)!.dueAt.toISOString(), "2026-10-13T13:00:00.000Z", "dueAt comes from the same helper as the ordering");
});
