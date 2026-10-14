/**
 * DB-backed tests for the owner-gated seed of the first real Sequence. The model is replaced by an injected generator;
 * everything else is real: name + company resolution, run-time re-validation, the single write transaction, the audit
 * row, idempotency and the drafting path. Opt-in and fail-closed: `npm run test:db`, DATABASE_URL pointing at a
 * database whose name ends in `_e2e`. Every row is created under a per-run token and removed afterwards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const key = (name: string) => `zz-${run}-${name}`;
const SEQ_NAME = `ZZ seed ${run}`;
let bdId: string;
let accountId: string;
const personIds: string[] = [];
const companyKeys: string[] = [];
const suppressionValues: string[] = [];

let modelCalls = 0;
const generator = async (input: { language: string; contact: { firstName: string | null } }) => {
  modelCalls++;
  return { ok: true as const, channel: "email" as const, message: "", subject: `Hello ${input.contact.firstName}`, body: `Hi ${input.contact.firstName},\n\nPitch in ${input.language}.\n\nCristian`, historyCount: 0, signals: [] };
};
const draftDeps = { generate: generator as never, siteUrl: "https://example.test" };

type Spec = { company?: string; posting?: boolean; client?: string | null; country?: string | null; email?: string | null; merged?: boolean };
const roster: { name: string; company: string }[] = [];

/** One person under a company with its own display name. `company` lets two people share one company. */
async function mkPerson(tag: string, spec: Spec = {}) {
  const { db } = await import("@/db");
  const { company, jobPosting, person, targetCompany } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const ck = key(spec.company ?? tag);
  if (!companyKeys.includes(ck)) {
    companyKeys.push(ck);
    await db.insert(company).values({ companyKey: ck, displayName: `Co ${ck}`, clientStatus: spec.client ?? null });
    await db.insert(targetCompany).values({ companyKey: ck, displayName: ck, ats: "lever", config: {} });
    await db.insert(jobPosting).values({ companyKey: ck, externalId: "1", title: "Engineer", location: "Miami, FL", url: "https://example.test", isIt: true, market: "us", isMiami: true, closedAt: spec.posting === false ? new Date() : null });
  } else if (spec.client !== undefined || spec.posting === false) {
    await db.update(company).set({ clientStatus: spec.client ?? null }).where(eq(company.companyKey, ck));
  }
  const email = spec.email === undefined ? `${key(tag)}@example.test` : spec.email;
  const [p] = await db
    .insert(person)
    .values({ firstName: tag, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", company: ck, companyKey: ck, country: spec.country ?? null, mergedIntoId: spec.merged ? personIds[0] : null })
    .returning();
  personIds.push(p.id);
  roster.push({ name: `${tag} ${run}`, company: `Co ${ck}` });
  return p.id;
}

async function counts() {
  const { db } = await import("@/db");
  const { auditLog, sequence, sequenceMember } = await import("@/db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const one = async (q: Promise<{ n: number }[]>) => (await q)[0].n;
  return {
    sequences: await one(db.select({ n: sql<number>`count(*)::int` }).from(sequence).where(eq(sequence.name, SEQ_NAME))),
    members: await one(db.select({ n: sql<number>`count(*)::int` }).from(sequenceMember).innerJoin(sequence, eq(sequence.id, sequenceMember.sequenceId)).where(eq(sequence.name, SEQ_NAME))),
    audits: await one(db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(and(eq(auditLog.actorBdId, bdId), eq(auditLog.action, "seed_outreach_sequence")))),
  };
}

const seed = async (apply: boolean, only?: readonly { name: string; company: string }[]) => {
  const { seedFirstSequence } = await import("@/lib/sequences/seedQueries");
  return seedFirstSequence({ actorBdId: bdId, apply, roster: only ?? roster, sequenceName: SEQ_NAME, draftDeps });
};
const labels = (cs: { label: string }[]) => cs.map((c) => c.label.split(" ")[0]);

before(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, emailSuppression } = await import("@/db/schema");
  const [a] = await db.insert(bd).values({ name: "ZZ Owner", email: `zz-seed-${run}@example.test` }).returning();
  bdId = a.id;
  const [acc] = await db.insert(emailAccount).values({ bdId, emailAddress: `zz-sender-${run}@example.test` }).returning();
  accountId = acc.id;
  await mkPerson("ok1");
  await mkPerson("ok2");
  await mkPerson("brazil", { country: "Brazil" });
  await mkPerson("pastclient", { client: "inactive" });
  await mkPerson("activeclient", { client: "active" });
  await mkPerson("closed", { posting: false });
  await mkPerson("noemail", { email: null });
  await mkPerson("merged", { merged: true });
  const blocked = `${key("blocked")}@example.test`;
  await mkPerson("blocked", { email: blocked });
  suppressionValues.push(blocked);
  await db.insert(emailSuppression).values({ kind: "address", value: blocked, source: "manual" });
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, emailAccount, emailSuppression, jobPosting, person, sequence, targetCompany } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(sequence).where(inArray(sequence.ownerBdId, [bdId]));
  if (suppressionValues.length) await db.delete(emailSuppression).where(inArray(emailSuppression.value, suppressionValues));
  await db.delete(person).where(inArray(person.id, personIds));
  await db.delete(jobPosting).where(inArray(jobPosting.companyKey, companyKeys));
  await db.delete(targetCompany).where(inArray(targetCompany.companyKey, companyKeys));
  await db.delete(company).where(inArray(company.companyKey, companyKeys));
  await db.delete(emailAccount).where(inArray(emailAccount.bdId, [bdId]));
  await db.delete(bd).where(inArray(bd.id, [bdId]));
});

test("a dry run reports the split and the market per person and writes nothing", async () => {
  const before = await counts();
  const r = await seed(false);
  assert.deepEqual(await counts(), before);
  assert.equal(r.applied, false);
  assert.deepEqual(labels(r.plan.resolution.admitted), ["ok1", "ok2", "brazil"]);
  const reasons = Object.fromEntries(r.plan.resolution.rejected.map((x) => [x.candidate.label.split(" ")[0], x.reason]));
  assert.deepEqual(reasons, { pastclient: "client", activeclient: "client", closed: "no_open_posting", noemail: "no_email", merged: "merged", blocked: "suppressed" });
  const lang = Object.fromEntries(r.plan.lines.map((l) => [l.candidate.label.split(" ")[0], [l.market, l.language]]));
  assert.deepEqual(lang.ok1, ["us", "en"]);
  assert.deepEqual(lang.brazil, ["latam", "es"]);
});

test("apply seeds the survivors as drafted, never approved or sent, with one audit row", async () => {
  const { db } = await import("@/db");
  const { sequence, sequenceDraft, sequenceMember } = await import("@/db/schema");
  const { DEFAULT_SCHEDULE } = await import("@/lib/sequences/schedule");
  const { eq } = await import("drizzle-orm");
  const r = await seed(true);
  assert.equal(r.createdSequence, true);
  assert.equal(r.addedPersonIds.length, 3);
  assert.ok(r.auditLogId);
  assert.deepEqual(r.drafts, { generated: 3, failed: 0, held: 0 });

  const [s] = await db.select().from(sequence).where(eq(sequence.id, r.sequenceId!));
  assert.equal(s.name, SEQ_NAME);
  assert.equal(s.ownerBdId, bdId);
  assert.equal(s.emailAccountId, accountId);
  assert.equal(s.dailySendCap, 5);
  assert.deepEqual(s.schedule, DEFAULT_SCHEDULE);

  const members = await db.select().from(sequenceMember).where(eq(sequenceMember.sequenceId, s.id));
  assert.equal(members.length, 3);
  for (const m of members) {
    assert.equal(m.state, "drafted");
    assert.equal(m.sentAt, null);
    assert.equal(m.repliedAt, null);
    assert.equal(m.reminderDueAt, null);
    assert.equal(m.holdReason, null);
    const drafts = await db.select().from(sequenceDraft).where(eq(sequenceDraft.sequenceMemberId, m.id));
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].approvedAt, null);
    assert.equal(drafts[0].approvedByBdId, null);
    assert.equal(drafts[0].scheduledFor, null);
    assert.equal(drafts[0].reviewedAt, null);
  }
  assert.deepEqual(await counts(), { sequences: 1, members: 3, audits: 1 });
});

test("the drafts come from the real market-keyed path: English for US, Spanish for LATAM", async () => {
  const { db } = await import("@/db");
  const { sequenceDraft, sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({ first: sequenceDraft.body, p: sequenceMember.personId })
    .from(sequenceDraft)
    .innerJoin(sequenceMember, eq(sequenceMember.id, sequenceDraft.sequenceMemberId));
  const byPerson = new Map(rows.map((r) => [r.p, r.first]));
  const brazilId = personIds[2];
  assert.match(byPerson.get(brazilId)!, /Pitch in es/);
  assert.match(byPerson.get(personIds[0])!, /Pitch in en/);
});

test("a second run adds nothing, calls no model and writes no audit row", async () => {
  const before = await counts();
  modelCalls = 0;
  const r = await seed(true);
  assert.deepEqual(r.addedPersonIds, []);
  assert.equal(r.auditLogId, null);
  assert.equal(r.createdSequence, false);
  assert.equal(modelCalls, 0);
  assert.deepEqual(await counts(), before);
  assert.deepEqual(r.plan.resolution.admitted, []);
  assert.equal(r.plan.resolution.rejected.filter((x) => x.reason === "already_member").length, 3);
});

test("a member removed by hand is not re-added by a re-run", async () => {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  await db.update(sequenceMember).set({ state: "discarded", discardReason: "owner removed", discardedAt: new Date() }).where(eq(sequenceMember.personId, personIds[0]));
  const before = await counts();
  const r = await seed(true);
  assert.deepEqual(r.addedPersonIds, []);
  assert.equal(r.auditLogId, null);
  assert.deepEqual(await counts(), before);
  const [m] = await db.select().from(sequenceMember).where(and(eq(sequenceMember.personId, personIds[0])));
  assert.equal(m.state, "discarded");
});

test("a candidate that drops off is left out and no one is picked to replace them", async () => {
  // Eligible people exist in the table that the owner never named: none may appear.
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  const named = roster.filter((r) => /^(ok1|ok2) /.test(r.name));
  const extra = await mkPerson("neverchosen");
  const r = await seed(false, named);
  assert.deepEqual(labels(r.plan.resolution.admitted), []); // ok1/ok2 are already members
  const [row] = await db.select().from(sequenceMember).where(inArray(sequenceMember.personId, [extra]));
  assert.equal(row, undefined);
});

test("an ambiguous name fails loudly and writes nothing", async () => {
  await mkPerson("twin", { company: "twinco" });
  await mkPerson("twin", { company: "twinco", email: `${key("twin-b")}@example.test` });
  const entry = roster.find((r) => r.name === `twin ${run}`)!;
  const before = await counts();
  await assert.rejects(() => seed(true, [entry]), /2 people match/);
  assert.deepEqual(await counts(), before);
});

test("a name that matches no one fails loudly and writes nothing", async () => {
  const before = await counts();
  await assert.rejects(() => seed(true, [{ name: `Nobody ${run}`, company: "No Such Company" }]), /no person matches/);
  assert.deepEqual(await counts(), before);
});

test("--apply without an actor is refused", async () => {
  const { seedFirstSequence } = await import("@/lib/sequences/seedQueries");
  await assert.rejects(() => seedFirstSequence({ actorBdId: null, apply: true, roster, sequenceName: SEQ_NAME }), /--actor/);
});
