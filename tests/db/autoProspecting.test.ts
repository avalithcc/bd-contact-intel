/**
 * Auto-prospecting against a scratch database: the producer (idempotent, verified decision-makers only), the consumer (switch,
 * gate 2 refusal recorded, in-play skips, a signal worked once) and the screen read. The model is a fake: no call leaves the process.
 *
 * Opt-in and fail-closed like the other files here: `npm run test:db`, DATABASE_URL pointing at a database whose name ends in `_e2e`.
 * Every row is created under a per-run token and removed afterwards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const key = (name: string) => `zz-${run}-${name}`;
const companyKeys: string[] = [];
const bdIds: string[] = [];
const sequenceIds: string[] = [];

type Seed = { ck: string; personId: string; bdId: string };

async function seed(name: string, o: { emailStatus?: string; enabled?: boolean; closed?: boolean; bdId?: string; roleGroup?: string } = {}): Promise<Seed> {
  const { db } = await import("@/db");
  const { bd, company, jobPosting, person, targetCompany } = await import("@/db/schema");
  const ck = key(name);
  companyKeys.push(ck);
  let bdId = o.bdId;
  if (!bdId) {
    const [b] = await db.insert(bd).values({ email: `${ck}@example.test`, name: "Bea Tester", autoProspectingEnabled: o.enabled ?? true }).returning();
    bdId = b!.id;
    bdIds.push(bdId);
  }
  await db.insert(company).values({ companyKey: ck, displayName: `Acme ${name}` });
  await db.insert(targetCompany).values({ companyKey: ck, displayName: `Acme ${name}`, ats: "lever", config: {} });
  await db.insert(jobPosting).values({
    companyKey: ck, externalId: "1", title: "Senior Backend Engineer", location: "Austin, TX", url: "https://example.test/1",
    isIt: true, market: "us", postedAt: new Date(), firstSeen: new Date(), closedAt: o.closed ? new Date() : null,
  });
  const email = `${ck}@example.test`;
  const [p] = await db
    .insert(person)
    .values({ firstName: name, lastName: run, email, emailNormalized: email, emailStatus: o.emailStatus ?? "verified", emailSource: "apollo", company: `Acme ${name}`, companyKey: ck, roleGroup: o.roleGroup ?? "c_level_tech", jobTitle: "CTO", ownerBdId: bdId })
    .returning();
  return { ck, personId: p!.id, bdId };
}

after(async () => {
  const { db } = await import("@/db");
  const { auditLog, bd, company, emailAccount, jobPosting, person, sequence, signal, targetCompany, task } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (sequenceIds.length) await db.delete(sequence).where(inArray(sequence.id, sequenceIds));
  if (companyKeys.length) {
    await db.delete(signal).where(inArray(signal.companyKey, companyKeys));
    await db.delete(task).where(inArray(task.companyKey, companyKeys));
    await db.delete(person).where(inArray(person.companyKey, companyKeys));
    await db.delete(jobPosting).where(inArray(jobPosting.companyKey, companyKeys));
    await db.delete(targetCompany).where(inArray(targetCompany.companyKey, companyKeys));
    await db.delete(company).where(inArray(company.companyKey, companyKeys));
  }
  if (bdIds.length) {
    await db.delete(auditLog).where(inArray(auditLog.actorBdId, bdIds));
    await db.delete(emailAccount).where(inArray(emailAccount.bdId, bdIds));
    await db.delete(bd).where(inArray(bd.id, bdIds));
  }
  await db.$client.end();
});

const signalsOf = async (ck: string) => {
  const { db } = await import("@/db");
  const { signal } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(signal).where(eq(signal.companyKey, ck));
};
const draftsOf = async (signalId: string) => {
  const { db } = await import("@/db");
  const { prospectDraft } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(prospectDraft).where(eq(prospectDraft.signalId, signalId));
};

/** A model that never has to be right: it only records that it was called. */
function fakeModel(body = "Hola Ana,\n\nVi que Acme busca un backend senior.\n\nTendrás 15 minutos la semana próxima?") {
  const calls: string[] = [];
  const generate = (async (args: { prompt: string }) => {
    calls.push(args.prompt);
    return { text: JSON.stringify({ subject: "Backend senior en Acme", body }), finishReason: "stop" };
  }) as never;
  return { generate, calls };
}

async function produce(actor: string) {
  const { produceHiringSignals } = await import("@/lib/prospecting/producer");
  return produceHiringSignals(actor, { execute: true });
}

test("the producer writes one signal for a verified decision-maker and never a second for the same posting", async () => {
  const a = await seed("verified");
  const first = await produce(a.bdId);
  assert.equal((await signalsOf(a.ck)).length, 1);
  assert.ok(first.length >= 1);
  const [sig] = await signalsOf(a.ck);
  assert.equal(sig!.source, "hiring");
  assert.equal((sig!.data as { title?: string }).title, "Senior Backend Engineer");

  await produce(a.bdId);
  assert.equal((await signalsOf(a.ck)).length, 1, "a second run must not duplicate");

  // The arbiter is the database, not the producer's own SELECT: a hand-written duplicate of the same posting is refused too.
  const { db } = await import("@/db");
  const { signal } = await import("@/db/schema");
  await assert.rejects(() => db.insert(signal).values({ companyKey: a.ck, source: "hiring", data: sig!.data as object }), /signal_hiring_posting_unique|duplicate key/);
});

test("a probable email produces no signal", async () => {
  const a = await seed("probable", { emailStatus: "probable" });
  await produce(a.bdId);
  assert.equal((await signalsOf(a.ck)).length, 0);
});

test("a verified email that is not a decision-maker produces no signal", async () => {
  const a = await seed("developer", { roleGroup: "developers" });
  await produce(a.bdId);
  assert.equal((await signalsOf(a.ck)).length, 0);
});

test("nothing is drafted for a BD who has not enabled it, and the signal stays unconsumed", async () => {
  const { consumeSignals } = await import("@/lib/prospecting/consumer");
  const a = await seed("off", { enabled: false });
  await produce(a.bdId);
  const m = fakeModel();
  await consumeSignals({ execute: true, generate: m.generate });
  const [sig] = await signalsOf(a.ck);
  assert.equal(sig!.consumedAt, null);
  assert.equal((await draftsOf(sig!.id)).length, 0);
  assert.equal(m.calls.filter((c) => c.includes("Acme off")).length, 0, "the model must never be asked to write for a BD who is off");
});

test("a draft is written once; a consumed signal is never reworked", async () => {
  const { consumeSignals } = await import("@/lib/prospecting/consumer");
  const a = await seed("drafted");
  await produce(a.bdId);
  const m = fakeModel();
  await consumeSignals({ execute: true, generate: m.generate });
  const [sig] = await signalsOf(a.ck);
  assert.ok(sig!.consumedAt);
  const drafts = await draftsOf(sig!.id);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]!.outcome, "drafted");
  assert.equal(drafts[0]!.personId, a.personId);
  assert.match(drafts[0]!.body ?? "", /Acme/);
  const callsAfterFirst = m.calls.length;

  await consumeSignals({ execute: true, generate: m.generate });
  assert.equal((await draftsOf(sig!.id)).length, 1);
  assert.equal(m.calls.length, callsAfterFirst, "the model must not be called again for a consumed signal");
});

test("gate 2: with no concrete company fact the generator refuses, records why, and the model is never called", async () => {
  const { consumeSignals } = await import("@/lib/prospecting/consumer");
  const a = await seed("nofact");
  await produce(a.bdId);
  // The posting that justified the signal closes before the draft is written: there is nothing left to write from.
  const { db } = await import("@/db");
  const { jobPosting } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  await db.update(jobPosting).set({ closedAt: new Date() }).where(eq(jobPosting.companyKey, a.ck));

  const m = fakeModel();
  await consumeSignals({ execute: true, generate: m.generate });
  const [sig] = await signalsOf(a.ck);
  const drafts = await draftsOf(sig!.id);
  assert.deepEqual(drafts.map((d) => [d.outcome, d.reason, d.body]), [["refused", "no_open_posting", null]]);
  assert.ok(sig!.consumedAt, "a refused signal is consumed, with the reason recorded");
  assert.equal(m.calls.length, 0);
});

test("gate 3: an open task, a recent email or an active sequence keeps a contact out, each recorded as a refusal", async () => {
  const { consumeSignals } = await import("@/lib/prospecting/consumer");
  const { db } = await import("@/db");
  const { activity, emailAccount, sequence, sequenceMember, task } = await import("@/db/schema");

  const withTask = await seed("task");
  await db.insert(task).values({ personId: withTask.personId, companyKey: withTask.ck, assignedToBdId: withTask.bdId, title: "Follow up", status: "open" });

  const withEmail = await seed("email");
  await db.insert(activity).values({ personId: withEmail.personId, actorBdId: withEmail.bdId, type: "email_sent", metadata: {} });

  const withSequence = await seed("sequence");
  const [acct] = await db.insert(emailAccount).values({ bdId: withSequence.bdId, emailAddress: `${withSequence.ck}-mbx@example.test` }).returning();
  const [seq] = await db.insert(sequence).values({ name: "zz", ownerBdId: withSequence.bdId, emailAccountId: acct!.id, schedule: {} }).returning();
  sequenceIds.push(seq!.id);
  await db.insert(sequenceMember).values({ sequenceId: seq!.id, personId: withSequence.personId, state: "drafted" });

  const m = fakeModel();
  for (const s of [withTask, withEmail, withSequence]) await produce(s.bdId);
  await consumeSignals({ execute: true, generate: m.generate });

  const reasons: Record<string, string | null> = {};
  for (const [label, s] of [["task", withTask], ["email", withEmail], ["sequence", withSequence]] as const) {
    const [sig] = await signalsOf(s.ck);
    const [d] = await draftsOf(sig!.id);
    assert.equal(d!.outcome, "refused", label);
    reasons[label] = d!.reason;
  }
  assert.deepEqual(reasons, { task: "open_follow_up", email: "recent_outreach", sequence: "in_active_sequence" });
  assert.equal(m.calls.filter((c) => /Acme (task|email|sequence)/.test(c)).length, 0);
});

test("the screen read lists the draft with the signal that caused it, and refusals with their reason", async () => {
  const { listProspectDrafts } = await import("@/lib/prospecting/queries");
  const { rows } = await listProspectDrafts(500);
  const mine = rows.filter((r) => r.companyName?.includes(`Acme`) && r.personName.endsWith(run));
  assert.ok(mine.some((r) => r.outcome === "drafted" && r.signalTitle === "Senior Backend Engineer" && r.body));
  assert.ok(mine.some((r) => r.outcome === "refused" && r.reason === "no_open_posting"));
});
