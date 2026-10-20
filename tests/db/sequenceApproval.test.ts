/**
 * DB-backed tests for Sequence approval: review tracking, single and bulk approval (the server re-asserts the review
 * gate), cancel, and the actor + timestamp audit row of every approval-side action. Opt-in and fail-closed:
 * `npm run test:db`, DATABASE_URL pointing at a database whose name ends in `_e2e`. Rows are created under a per-run
 * token and removed afterwards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const key = (name: string) => `zz-${run}-${name}`;
let bdId: string;
let otherBdId: string;
let sequenceId: string;
const personIds: string[] = [];

/** A body from the real footer producer, never a hand-typed footer. The default recipient (United States) resolves to "miami". */
async function footedBody(address: "miami" | "mdp" = "miami") {
  const { appendFooter } = await import("@/lib/sequences/complianceFooter");
  const { COMPLIANCE_CONFIG } = await import("@/lib/sequences/config");
  const { buildUnsubscribeUrl, generateUnsubscribeToken } = await import("@/lib/sequences/unsubscribeToken");
  const r = appendFooter("Hello there", COMPLIANCE_CONFIG, address, buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken()));
  assert.equal(r.status, "ok");
  return r.status === "ok" ? r.body : "";
}

async function mkMember(name: string, over: { state?: string; subject?: string; reviewed?: boolean; noDraft?: boolean; body?: string; country?: string | null } = {}) {
  const { db } = await import("@/db");
  const { person, sequenceDraft, sequenceMember } = await import("@/db/schema");
  const email = `${key(name)}@example.test`;
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", country: over.country === undefined ? "United States" : over.country }).returning();
  personIds.push(p.id);
  const [m] = await db.insert(sequenceMember).values({ sequenceId, personId: p.id, state: over.state ?? "drafted" }).returning();
  if (!over.noDraft) {
    await db.insert(sequenceDraft).values({ sequenceMemberId: m.id, step: 1, subject: over.subject ?? `Hello ${name}`, body: over.body ?? (await footedBody()), reviewedAt: over.reviewed ? new Date() : null });
  }
  return { memberId: m.id, personId: p.id };
}

async function draftOf(memberId: string, step = 1) {
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceDraft).where(and(eq(sequenceDraft.sequenceMemberId, memberId), eq(sequenceDraft.step, step))))[0];
}

async function stateOf(memberId: string) {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceMember).where(eq(sequenceMember.id, memberId)))[0];
}

async function auditFor(personId: string, action: string) {
  const { db } = await import("@/db");
  const { auditLog } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  return db.select().from(auditLog).where(and(eq(auditLog.personId, personId), eq(auditLog.action, action)));
}

before(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, sequence } = await import("@/db/schema");
  const [a] = await db.insert(bd).values({ name: "ZZ Approver", email: `zz-appr-${run}@example.test` }).returning();
  const [b] = await db.insert(bd).values({ name: "ZZ Stranger", email: `zz-appr-other-${run}@example.test` }).returning();
  bdId = a.id;
  otherBdId = b.id;
  const [acc] = await db.insert(emailAccount).values({ bdId, emailAddress: `zz-appr-sender-${run}@example.test` }).returning();
  const [s] = await db.insert(sequence).values({ name: key("seq"), ownerBdId: bdId, emailAccountId: acc.id, schedule: {} }).returning();
  sequenceId = s.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { auditLog, bd, emailAccount, person, sequence } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(sequence).where(inArray(sequence.ownerBdId, [bdId]));
  if (personIds.length) {
    await db.delete(auditLog).where(inArray(auditLog.personId, personIds));
    await db.delete(person).where(inArray(person.id, personIds));
  }
  await db.delete(auditLog).where(inArray(auditLog.actorBdId, [bdId, otherBdId]));
  await db.delete(emailAccount).where(inArray(emailAccount.bdId, [bdId, otherBdId]));
  await db.delete(bd).where(inArray(bd.id, [bdId, otherBdId]));
});

test("opening the dialog marks the draft reviewed and stays marked; an unopened draft is untouched", async () => {
  const { markDraftReviewed } = await import("@/lib/sequences/approvalQueries");
  const opened = await mkMember("open");
  const passive = await mkMember("passive");
  assert.deepEqual(await markDraftReviewed(bdId, opened.memberId), { ok: true });
  const first = (await draftOf(opened.memberId)).reviewedAt;
  assert.ok(first);
  assert.equal((await draftOf(opened.memberId)).reviewedByBdId, bdId);
  await markDraftReviewed(bdId, opened.memberId);
  assert.deepEqual((await draftOf(opened.memberId)).reviewedAt, first, "re-opening keeps the first review time");
  assert.equal((await draftOf(passive.memberId)).reviewedAt, null);
});

test("another BD cannot mark, approve or cancel a member of someone else's sequence", async () => {
  const { approveMember, cancelApproval, markDraftReviewed } = await import("@/lib/sequences/approvalQueries");
  const m = await mkMember("foreign");
  assert.deepEqual(await markDraftReviewed(otherBdId, m.memberId), { ok: false, error: "not_found" });
  const approved = await approveMember(otherBdId, m.memberId);
  assert.ok(!approved.ok && approved.rejected[0].reason === "not_found");
  assert.deepEqual(await cancelApproval(otherBdId, m.memberId), { ok: false, error: "not_found" });
  assert.equal((await stateOf(m.memberId)).state, "drafted");
});

test("single approve works on a never-opened draft, records actor and time, and schedules step 1 for the next day 09:00 Miami", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const { step1DueAt } = await import("@/lib/sequences/schedule");
  const m = await mkMember("single");
  const before = Date.now();
  const result = await approveMember(bdId, m.memberId);
  assert.deepEqual(result, { ok: true, approved: [m.memberId] });
  const d = await draftOf(m.memberId);
  assert.equal(d.approvedByBdId, bdId);
  assert.ok(d.approvedAt && d.approvedAt.getTime() >= before - 1000);
  assert.equal(d.scheduledFor?.toISOString(), step1DueAt(d.approvedAt!).toISOString());
  assert.equal((await stateOf(m.memberId)).state, "approved");
  const audit = await auditFor(m.personId, "sequence_member_approve");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actorBdId, bdId);
});

test("approving a member that is not drafted is rejected and changes nothing", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const m = await mkMember("sent", { state: "sent" });
  const result = await approveMember(bdId, m.memberId);
  assert.ok(!result.ok && result.rejected[0].reason === "not_approvable");
  assert.equal((await stateOf(m.memberId)).state, "sent");
  assert.equal((await draftOf(m.memberId)).approvedAt, null);
});

test("a step 1 subject starting with Re: is rejected at approval", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const m = await mkMember("reprefix", { subject: "Re: your engineers" });
  const result = await approveMember(bdId, m.memberId);
  assert.ok(!result.ok && result.rejected[0].reason === "reply_prefix_subject");
  assert.equal((await stateOf(m.memberId)).state, "drafted");
});

test("a member without a draft cannot be approved", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const m = await mkMember("nodraft", { noDraft: true });
  const result = await approveMember(bdId, m.memberId);
  assert.ok(!result.ok && result.rejected[0].reason === "no_draft");
});

test("bulk approve with every draft reviewed approves all of them", async () => {
  const { approveBulk } = await import("@/lib/sequences/approvalQueries");
  const a = await mkMember("bulk-a", { reviewed: true });
  const b = await mkMember("bulk-b", { reviewed: true });
  const result = await approveBulk(bdId, [a.memberId, b.memberId]);
  assert.ok(result.ok && result.approved.length === 2);
  assert.equal((await stateOf(a.memberId)).state, "approved");
  assert.equal((await stateOf(b.memberId)).state, "approved");
});

test("a forged bulk request with one unreviewed member approves none and names that member", async () => {
  const { approveBulk } = await import("@/lib/sequences/approvalQueries");
  const a = await mkMember("forge-a", { reviewed: true });
  const b = await mkMember("forge-b", { reviewed: false });
  const c = await mkMember("forge-c", { reviewed: true });
  const result = await approveBulk(bdId, [a.memberId, b.memberId, c.memberId]);
  assert.ok(!result.ok);
  assert.deepEqual(result.rejected, [{ memberId: b.memberId, reason: "unreviewed" }]);
  for (const m of [a, b, c]) {
    assert.equal((await stateOf(m.memberId)).state, "drafted");
    assert.equal((await draftOf(m.memberId)).approvedAt, null);
  }
});

test("an edit after review clears it, so a bulk approval cannot cover unseen content", async () => {
  const { approveBulk } = await import("@/lib/sequences/approvalQueries");
  const { saveDraftEdit } = await import("@/lib/sequences/draftQueries");
  const m = await mkMember("edited", { reviewed: true });
  await saveDraftEdit(bdId, m.memberId, { subject: "New subject", body: `${await footedBody()}\n\nEdited.` });
  const result = await approveBulk(bdId, [m.memberId]);
  assert.ok(!result.ok && result.rejected[0].reason === "unreviewed");
});

test("cancel returns an approved member to drafted, clears the approval and writes the audit row", async () => {
  const { approveMember, cancelApproval } = await import("@/lib/sequences/approvalQueries");
  const m = await mkMember("cancel");
  await approveMember(bdId, m.memberId);
  assert.deepEqual(await cancelApproval(bdId, m.memberId), { ok: true });
  const d = await draftOf(m.memberId);
  assert.deepEqual([d.approvedAt, d.approvedByBdId, d.scheduledFor], [null, null, null]);
  assert.equal((await stateOf(m.memberId)).state, "drafted");
  const audit = await auditFor(m.personId, "sequence_member_cancel");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actorBdId, bdId);
  assert.deepEqual(await cancelApproval(bdId, m.memberId), { ok: false, error: "not_approved" });
});

test("discard, re-admit and regenerate each write the actor BD and a timestamp", async () => {
  const { removeMembersFromSequence, reinstateSequenceMember } = await import("@/lib/sequences/rosterQueries");
  const { regenerateDrafts } = await import("@/lib/sequences/draftQueries");
  const m = await mkMember("history");
  await removeMembersFromSequence(bdId, sequenceId, [m.memberId], "not a fit");
  await reinstateSequenceMember(bdId, m.memberId);
  const generate = async () => ({ ok: true as const, channel: "email" as const, message: "", subject: "Fresh", body: "Fresh body", historyCount: 0, signals: [] });
  await regenerateDrafts(bdId, sequenceId, [m.memberId], { generate: generate as never, siteUrl: "https://example.test" });
  for (const action of ["sequence_member_discard", "sequence_member_readmit", "sequence_member_regenerate"]) {
    const rows = await auditFor(m.personId, action);
    assert.equal(rows.length, 1, action);
    assert.equal(rows[0].actorBdId, bdId, action);
    assert.ok(rows[0].at instanceof Date, action);
  }
});

async function mkSent(name: string, over: { reviewed?: boolean; reminderDueAt?: Date | null; noReminder?: boolean; reminderBody?: string } = {}) {
  const { db } = await import("@/db");
  const { sequenceDraft, sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const m = await mkMember(name, { state: "sent" });
  const dueAt = over.reminderDueAt === undefined ? new Date(Date.now() + 7 * 86_400_000) : over.reminderDueAt;
  await db.update(sequenceMember).set({ sentAt: new Date(), reminderDueAt: dueAt }).where(eq(sequenceMember.id, m.memberId));
  if (!over.noReminder) {
    await db.insert(sequenceDraft).values({ sequenceMemberId: m.memberId, step: 2, subject: "Re: Hello", body: over.reminderBody ?? (await footedBody()), reviewedAt: over.reviewed ? new Date() : null });
  }
  return m;
}

test("approving step 1 does not approve the reminder, and the reminder is approved on its own without moving the member", async () => {
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const { reminderReleaseAt } = await import("@/lib/sequences/schedule");
  const m = await mkSent("reminder");
  await db.update(sequenceDraft).set({ approvedAt: new Date(), approvedByBdId: bdId }).where(and(eq(sequenceDraft.sequenceMemberId, m.memberId), eq(sequenceDraft.step, 1)));
  assert.equal((await draftOf(m.memberId, 2)).approvedAt, null, "step 1 approval implies nothing about step 2");
  assert.deepEqual(await approveMember(bdId, m.memberId, 2), { ok: true, approved: [m.memberId] });
  const reminder = await draftOf(m.memberId, 2);
  assert.equal(reminder.approvedByBdId, bdId);
  const member = await stateOf(m.memberId);
  assert.equal(member.state, "sent");
  assert.equal(reminder.scheduledFor?.toISOString(), reminderReleaseAt(member.reminderDueAt!, reminder.approvedAt!)!.toISOString());
  const audit = await auditFor(m.personId, "sequence_member_approve");
  assert.deepEqual(audit.map((a) => (a.metadata as { step: number }).step), [2]);
});

test("a reminder cannot be approved unless the member is sent and the reminder is due-scheduled", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const drafted = await mkMember("rem-drafted");
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  await db.insert(sequenceDraft).values({ sequenceMemberId: drafted.memberId, step: 2, subject: "x", body: "y" });
  const early = await approveMember(bdId, drafted.memberId, 2);
  assert.ok(!early.ok && early.rejected[0].reason === "not_approvable");
  const noDue = await mkSent("rem-nodue", { reminderDueAt: null });
  const result = await approveMember(bdId, noDue.memberId, 2);
  assert.ok(!result.ok && result.rejected[0].reason === "not_approvable");
});

test("reminder bulk approval uses the same review gate", async () => {
  const { approveBulk } = await import("@/lib/sequences/approvalQueries");
  const a = await mkSent("rem-bulk-a", { reviewed: true });
  const b = await mkSent("rem-bulk-b", { reviewed: false });
  const blocked = await approveBulk(bdId, [a.memberId, b.memberId], 2);
  assert.ok(!blocked.ok && blocked.rejected.length === 1 && blocked.rejected[0].memberId === b.memberId);
  assert.equal((await draftOf(a.memberId, 2)).approvedAt, null);
});

test("advancing the reminder moves the due date only: it stays unapproved and has no release instant", async () => {
  const { advanceReminder } = await import("@/lib/sequences/approvalQueries");
  const m = await mkSent("advance");
  const beforeDue = (await stateOf(m.memberId)).reminderDueAt!;
  assert.deepEqual(await advanceReminder(otherBdId, m.memberId), { ok: false, error: "not_found" });
  assert.deepEqual(await advanceReminder(bdId, m.memberId), { ok: true });
  const after = await stateOf(m.memberId);
  assert.ok(after.reminderDueAt!.getTime() < beforeDue.getTime());
  assert.equal(after.state, "sent");
  assert.equal((await draftOf(m.memberId, 2)).approvedAt, null);
  assert.equal((await draftOf(m.memberId, 2)).scheduledFor, null);
});

test("cancelling a reminder approval clears only the reminder and leaves the member sent", async () => {
  const { approveMember, cancelApproval } = await import("@/lib/sequences/approvalQueries");
  const m = await mkSent("rem-cancel");
  assert.deepEqual(await cancelApproval(bdId, m.memberId, 2), { ok: false, error: "not_approved" });
  await approveMember(bdId, m.memberId, 2);
  assert.deepEqual(await cancelApproval(bdId, m.memberId, 2), { ok: true });
  const d = await draftOf(m.memberId, 2);
  assert.deepEqual([d.approvedAt, d.approvedByBdId, d.scheduledFor], [null, null, null]);
  assert.equal((await stateOf(m.memberId)).state, "sent");
  const audit = await auditFor(m.personId, "sequence_member_cancel");
  assert.deepEqual(audit.map((a) => (a.metadata as { step: number }).step), [2]);
});

async function nothingWritten(m: { memberId: string; personId: string }, state: string, step = 1) {
  const d = await draftOf(m.memberId, step);
  assert.deepEqual([d.approvedAt, d.approvedByBdId, d.scheduledFor], [null, null, null]);
  assert.equal((await stateOf(m.memberId)).state, state);
  assert.equal((await auditFor(m.personId, "sequence_member_approve")).length, 0);
}

test("a draft footed for another address than the audience now resolves to is refused as missing_footer, and nothing is written", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  // The draft carries the Mar del Plata footer; the recipient (United States) resolves to Miami today.
  const m = await mkMember("drift", { body: await footedBody("mdp") });
  const r = await approveMember(bdId, m.memberId);
  assert.deepEqual(r, { ok: false, error: "rejected", rejected: [{ memberId: m.memberId, reason: "missing_footer" }] });
  await nothingWritten(m, "drafted");
});

test("a recipient with no location signal is refused as unmapped_market, and nothing is written", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const m = await mkMember("nowhere", { country: null });
  const r = await approveMember(bdId, m.memberId);
  assert.deepEqual(r, { ok: false, error: "rejected", rejected: [{ memberId: m.memberId, reason: "unmapped_market" }] });
  await nothingWritten(m, "drafted");
});

test("a healthy member still approves, and one refused member refuses the whole bulk request", async () => {
  const { approveBulk, approveMember } = await import("@/lib/sequences/approvalQueries");
  const ok = await mkMember("healthy");
  assert.deepEqual(await approveMember(bdId, ok.memberId), { ok: true, approved: [ok.memberId] });
  const good = await mkMember("bulk-good", { reviewed: true });
  const bad = await mkMember("bulk-bad", { reviewed: true, body: "Body without a footer" });
  const r = await approveBulk(bdId, [good.memberId, bad.memberId]);
  assert.deepEqual(r, { ok: false, error: "rejected", rejected: [{ memberId: bad.memberId, reason: "missing_footer" }] });
  await nothingWritten(good, "drafted");
  await nothingWritten(bad, "drafted");
});

test("the step 2 reminder is gated by the same footer check", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const drifted = await mkSent("rem-drift", { reminderBody: await footedBody("mdp") });
  const r = await approveMember(bdId, drifted.memberId, 2);
  assert.deepEqual(r, { ok: false, error: "rejected", rejected: [{ memberId: drifted.memberId, reason: "missing_footer" }] });
  await nothingWritten(drifted, "sent", 2);
});

test("a recipient in an embargoed country is refused as unmapped_market at approval, and nothing is written", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  // The draft is correctly footed (Miami): only the embargo can refuse it, so a resolver that defaulted to Miami would pass it.
  const m = await mkMember("embargoed", { country: "Cuba" });
  const r = await approveMember(bdId, m.memberId);
  assert.deepEqual(r, { ok: false, error: "rejected", rejected: [{ memberId: m.memberId, reason: "unmapped_market" }] });
  await nothingWritten(m, "drafted");
});
