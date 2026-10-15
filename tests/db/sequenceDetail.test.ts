/**
 * DB-backed tests for getSequenceDetail: owner scoping, the admin audit row, and the card facts it assembles. Opt-in and
 * fail-closed like the other sequence DB tests (`npm run test:db`, database name ending in `_e2e`). Every person and
 * company is synthetic and tagged with a per-run token.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const key = (name: string) => `zz-${run}-${name}`;
let ownerId: string;
let strangerId: string;
let adminId: string;
let accountId: string;
let sequenceId: string;
let emptySequenceId: string;
const personIds: string[] = [];
const memberIds: Record<string, string> = {};
const companyKeys: string[] = [];

async function mkMember(name: string, state: string, over: { roleGroup?: string; draft?: boolean; reminderDraft?: boolean; florida?: boolean; emailStatus?: string } = {}) {
  const { db } = await import("@/db");
  const { company, jobPosting, person, sequenceDraft, sequenceMember, targetCompany } = await import("@/db/schema");
  const ck = key(`co-${name}`);
  companyKeys.push(ck);
  await db.insert(company).values({ companyKey: ck, displayName: ck });
  await db.insert(targetCompany).values({ companyKey: ck, displayName: ck, ats: "lever", config: {} });
  await db.insert(jobPosting).values([
    { companyKey: ck, externalId: "1", title: "Engineer", location: "Miami, FL", url: "https://example.test", isIt: true, market: "us", isMiami: over.florida ?? false },
    { companyKey: ck, externalId: "2", title: "SRE", location: "Austin, TX", url: "https://example.test", isIt: true, market: "us", isMiami: false },
  ]);
  const email = `${key(name)}@example.test`;
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email, emailStatus: over.emailStatus ?? "verified", emailSource: "apollo", jobTitle: "Role", company: ck, companyKey: ck, roleGroup: over.roleGroup ?? null }).returning();
  personIds.push(p.id);
  const [m] = await db.insert(sequenceMember).values({ sequenceId, personId: p.id, state, holdReason: state === "approved" ? "sync_stale" : null }).returning();
  memberIds[name] = m.id;
  if (over.draft !== false) await db.insert(sequenceDraft).values({ sequenceMemberId: m.id, step: 1, subject: `Subject ${name}`, body: `Body ${name}` });
  if (over.reminderDraft) await db.insert(sequenceDraft).values({ sequenceMemberId: m.id, step: 2, subject: `Re ${name}`, body: `Reminder ${name}` });
  return p.id;
}

async function auditRows(actorBdId: string) {
  const { db } = await import("@/db");
  const { auditLog } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  return db.select().from(auditLog).where(and(eq(auditLog.actorBdId, actorBdId), eq(auditLog.action, "view_sequence")));
}

before(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, sequence } = await import("@/db/schema");
  const mk = async (n: string, role: string) => (await db.insert(bd).values({ name: `ZZ ${n}`, email: `zz-detail-${n}-${run}@example.test`, role }).returning())[0].id;
  ownerId = await mk("owner", "bd");
  strangerId = await mk("stranger", "bd");
  adminId = await mk("admin", "admin");
  accountId = (await db.insert(emailAccount).values({ bdId: ownerId, emailAddress: `zz-detail-sender-${run}@example.test` }).returning())[0].id;
  sequenceId = (await db.insert(sequence).values({ name: key("seq"), ownerBdId: ownerId, emailAccountId: accountId, schedule: {} }).returning())[0].id;
  emptySequenceId = (await db.insert(sequence).values({ name: key("empty"), ownerBdId: ownerId, emailAccountId: accountId, schedule: {} }).returning())[0].id;
  await mkMember("d1", "drafted", { roleGroup: "eng_leadership", florida: true });
  await mkMember("sent1", "sent", { reminderDraft: true, emailStatus: "probable" });
  await mkMember("appr1", "approved");
  await mkMember("rep1", "replied");
  await mkMember("disc1", "discarded", { draft: false });
});

after(async () => {
  const { db } = await import("@/db");
  const { auditLog, bd, company, emailAccount, person, sequence, targetCompany } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(sequence).where(inArray(sequence.ownerBdId, [ownerId]));
  await db.delete(person).where(inArray(person.id, personIds));
  await db.delete(targetCompany).where(inArray(targetCompany.companyKey, companyKeys));
  await db.delete(company).where(inArray(company.companyKey, companyKeys));
  await db.delete(auditLog).where(inArray(auditLog.actorBdId, [ownerId, strangerId, adminId]));
  await db.delete(emailAccount).where(inArray(emailAccount.bdId, [ownerId]));
  await db.delete(bd).where(inArray(bd.id, [ownerId, strangerId, adminId]));
});

test("the owner reads their Sequence with every member, ordered drafted, approved, replied, sent, discarded", async () => {
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const d = await getSequenceDetail({ id: ownerId, role: "bd" }, sequenceId);
  assert.ok(d);
  assert.equal(d.name, key("seq"));
  assert.equal(d.ownerName, "ZZ owner");
  assert.equal(d.fromAddress, `zz-detail-sender-${run}@example.test`);
  assert.deepEqual(d.members.map((m) => m.state), ["drafted", "approved", "replied", "sent", "discarded"]);
});

test("card facts: posting count, Florida, leadership, verified email, draft bodies, hold reason", async () => {
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const d = await getSequenceDetail({ id: ownerId, role: "bd" }, sequenceId);
  const by = (s: string) => d!.members.find((m) => m.memberId === memberIds[s])!;
  assert.equal(by("d1").openIt, 2);
  assert.equal(by("d1").florida, true);
  assert.equal(by("d1").leadership, true);
  assert.equal(by("d1").emailVerified, true);
  assert.equal(by("d1").draft?.body, "Body d1");
  assert.equal(by("d1").draft?.reviewedAt, null);
  assert.equal(by("appr1").florida, false);
  assert.equal(by("appr1").leadership, false);
  assert.equal(by("appr1").holdReason, "sync_stale");
  assert.equal(by("sent1").emailVerified, false);
  assert.equal(by("sent1").reminderDraft?.subject, "Re sent1");
  assert.equal(by("disc1").draft, null);
  assert.equal(by("d1").lastContactAt, null);
});

test("timestamps come back as Date, never strings", async () => {
  const { db } = await import("@/db");
  const { activity, sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const [m] = await db.select().from(sequenceMember).where(eq(sequenceMember.id, memberIds.sent1));
  await db.insert(activity).values({ personId: m.personId, actorBdId: ownerId, type: "email_sent", metadata: {} });
  await db.update(sequenceMember).set({ sentAt: new Date(), reminderDueAt: new Date(Date.now() + 86_400_000) }).where(eq(sequenceMember.id, memberIds.sent1));
  const d = await getSequenceDetail({ id: ownerId, role: "bd" }, sequenceId);
  const s = d!.members.find((x) => x.memberId === memberIds.sent1)!;
  for (const v of [s.sentAt, s.reminderDueAt, s.lastContactAt]) assert.ok(v instanceof Date, String(v));
});

test("an empty roster still returns the Sequence", async () => {
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const d = await getSequenceDetail({ id: ownerId, role: "bd" }, emptySequenceId);
  assert.ok(d);
  assert.deepEqual(d.members, []);
});

test("another BD gets null, a missing id gets null, a malformed id gets null; none writes an audit row", async () => {
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  assert.equal(await getSequenceDetail({ id: strangerId, role: "bd" }, sequenceId), null);
  assert.equal(await getSequenceDetail({ id: ownerId, role: "bd" }, randomUUID()), null);
  assert.equal(await getSequenceDetail({ id: ownerId, role: "bd" }, "not-a-uuid"), null);
  assert.equal((await auditRows(strangerId)).length, 0);
});

test("an admin reading another BD's Sequence sees the drafts AND leaves an audit row naming admin, owner and Sequence", async () => {
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const before = Date.now();
  const d = await getSequenceDetail({ id: adminId, role: "admin" }, sequenceId);
  assert.ok(d);
  assert.equal(d.members.find((m) => m.memberId === memberIds.d1)?.draft?.body, "Body d1");
  const rows = await auditRows(adminId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].targetBdId, ownerId);
  assert.deepEqual(rows[0].metadata, { sequenceId });
  assert.ok(rows[0].at.getTime() >= before - 2000);
});

test("the admin audit-log screen's query lists the view_sequence row with the Sequence name and the owner", async () => {
  const { listConversationAuditLog } = await import("@/lib/activity/auditLogQueries");
  const page = await listConversationAuditLog(1, 200);
  const row = page.rows.find((r) => r.actorBdId === adminId && r.action === "view_sequence");
  assert.ok(row, "the screen must show what the audit writes");
  assert.equal(row.sequenceName, key("seq"));
  assert.equal(row.targetBdName, "ZZ owner");
  assert.equal(row.personId, null);
});

test("an admin reading a missing Sequence gets null and no audit row", async () => {
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const n = (await auditRows(adminId)).length;
  assert.equal(await getSequenceDetail({ id: adminId, role: "admin" }, randomUUID()), null);
  assert.equal((await auditRows(adminId)).length, n);
});

test("the owner reading their own Sequence writes no audit row", async () => {
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  await getSequenceDetail({ id: ownerId, role: "bd" }, sequenceId);
  assert.equal((await auditRows(ownerId)).length, 0);
});

test("a member card shows the canonical company for a null free text, the free text when present, and null for a key with no company row", async () => {
  const { db } = await import("@/db");
  const { company, person, sequence, sequenceMember, targetCompany } = await import("@/db/schema");
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const [seq] = await db.insert(sequence).values({ name: key("names"), ownerBdId: ownerId, emailAccountId: accountId, schedule: {} }).returning();
  const add = async (name: string, displayName: string | null, freeText: string | null) => {
    const ck = key(`nm-${name}`);
    companyKeys.push(ck);
    if (displayName !== null) await db.insert(company).values({ companyKey: ck, displayName });
    await db.insert(targetCompany).values({ companyKey: ck, displayName: displayName ?? ck, ats: "lever", config: {} });
    const email = `${key(`nm-${name}`)}@example.test`;
    const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email, company: freeText, companyKey: ck }).returning();
    personIds.push(p.id);
    await db.insert(sequenceMember).values({ sequenceId: seq.id, personId: p.id, state: "drafted" });
    return p.id;
  };
  const free = await add("free", `Canon Free ${run}`, `Free Text ${run}`);
  const nullFree = await add("null", `Canon Null ${run}`, null);
  const dangling = await add("dangling", null, null);
  const d = await getSequenceDetail({ id: ownerId, role: "bd" }, seq.id);
  const by = (id: string) => d!.members.find((m) => m.personId === id)!;
  assert.equal(by(free).company, `Free Text ${run}`);
  assert.equal(by(nullFree).company, `Canon Null ${run}`);
  assert.equal(by(dangling).company, null);
});
