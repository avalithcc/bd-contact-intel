/**
 * DB-backed tests for Sequence drafting. The model is replaced by an injected generator (the real one needs the AI
 * gateway); everything else is real: market resolution from person/company/postings, the unsubscribe token, the
 * footer, edit protection and state transitions. Opt-in and fail-closed: `npm run test:db`, DATABASE_URL pointing at a
 * database whose name ends in `_e2e`. Every row is created under a per-run token and removed afterwards.
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
let accountId: string;
let sequenceId: string;
const personIds: string[] = [];
const companyKeys: string[] = [];

type Input = { language: string; channel: string; purpose?: string; contact: { firstName: string | null } };
const calls: Input[] = [];
const generator =
  (failFor: string[] = []) =>
  async (input: Input) => {
    calls.push(input);
    if (failFor.includes(input.contact.firstName ?? "")) return { ok: false as const, errorKey: "generationFailed" as const };
    return {
      ok: true as const,
      channel: "email" as const,
      message: "",
      subject: `Hello ${input.contact.firstName}`,
      body: `Hi ${input.contact.firstName},\n\nPitch in ${input.language}.\n\nCristian`,
      historyCount: 0,
      signals: [],
    };
  };
const deps = (failFor: string[] = []) => ({ generate: generator(failFor) as never, siteUrl: "https://example.test" });

async function mkCompany(name: string) {
  const { db } = await import("@/db");
  const { company, jobPosting, targetCompany } = await import("@/db/schema");
  const ck = key(name);
  companyKeys.push(ck);
  await db.insert(company).values({ companyKey: ck, displayName: ck });
  await db.insert(targetCompany).values({ companyKey: ck, displayName: ck, ats: "lever", config: {} });
  await db.insert(jobPosting).values({ companyKey: ck, externalId: "1", title: "Engineer", location: "Miami, FL", url: "https://example.test", isIt: true, market: "us", isMiami: true });
  return ck;
}

async function mkMember(name: string, over: { country?: string; state?: string } = {}) {
  const { db } = await import("@/db");
  const { person, sequenceMember } = await import("@/db/schema");
  const ck = await mkCompany(name);
  const email = `${key(name)}@example.test`;
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", company: ck, companyKey: ck, country: over.country ?? null }).returning();
  personIds.push(p.id);
  const [m] = await db.insert(sequenceMember).values({ sequenceId, personId: p.id, state: over.state ?? "drafted" }).returning();
  return m.id;
}

async function draftOf(memberId: string) {
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceDraft).where(eq(sequenceDraft.sequenceMemberId, memberId)))[0];
}

async function memberOf(memberId: string) {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceMember).where(eq(sequenceMember.id, memberId)))[0];
}

async function setDraft(memberId: string, over: Record<string, unknown>) {
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  await db.insert(sequenceDraft).values({ sequenceMemberId: memberId, step: 1, subject: "S", body: "B", ...over });
}

before(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, sequence } = await import("@/db/schema");
  const [a] = await db.insert(bd).values({ name: "ZZ Drafter", email: `zz-draft-${run}@example.test` }).returning();
  const [b] = await db.insert(bd).values({ name: "ZZ Stranger", email: `zz-stranger-${run}@example.test` }).returning();
  bdId = a.id;
  otherBdId = b.id;
  const [acc] = await db.insert(emailAccount).values({ bdId, emailAddress: `zz-sender-${run}@example.test` }).returning();
  accountId = acc.id;
  const [s] = await db.insert(sequence).values({ name: key("seq"), ownerBdId: bdId, emailAccountId: accountId, schedule: {} }).returning();
  sequenceId = s.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, emailAccount, jobPosting, person, sequence, targetCompany } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(sequence).where(inArray(sequence.ownerBdId, [bdId]));
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
  if (companyKeys.length) {
    await db.delete(jobPosting).where(inArray(jobPosting.companyKey, companyKeys));
    await db.delete(targetCompany).where(inArray(targetCompany.companyKey, companyKeys));
    await db.delete(company).where(inArray(company.companyKey, companyKeys));
  }
  await db.delete(emailAccount).where(inArray(emailAccount.bdId, [bdId, otherBdId]));
  await db.delete(bd).where(inArray(bd.id, [bdId, otherBdId]));
});

test("a US member is drafted in English with the Florida footer appended after the body", async () => {
  const { generateMissingDrafts } = await import("@/lib/sequences/draftQueries");
  const { COMPLIANCE_CONFIG } = await import("@/lib/sequences/config");
  const m = await mkMember("usa");
  calls.length = 0;
  const result = await generateMissingDrafts(bdId, sequenceId, deps());
  assert.ok(result.ok && result.generated.includes(m));
  assert.deepEqual(calls.map((c) => [c.language, c.channel]), [["en", "email"]]);
  const d = await draftOf(m);
  assert.ok(d.body.startsWith("Hi usa,"));
  assert.ok(d.body.includes(COMPLIANCE_CONFIG.us!.postalAddress));
  assert.match(d.body, /https:\/\/example\.test\/api\/unsubscribe\?t=\S+$/);
  assert.equal((await memberOf(m)).state, "drafted");
});

test("a LATAM member (person country wins over a US posting) is drafted in Spanish with the Argentina footer", async () => {
  const { generateMissingDrafts } = await import("@/lib/sequences/draftQueries");
  const { COMPLIANCE_CONFIG } = await import("@/lib/sequences/config");
  const m = await mkMember("latam", { country: "Argentina" });
  calls.length = 0;
  await generateMissingDrafts(bdId, sequenceId, deps());
  assert.deepEqual(calls.filter((c) => c.contact.firstName === "latam").map((c) => c.language), ["es"]);
  const d = await draftOf(m);
  assert.ok(d.body.includes(COMPLIANCE_CONFIG.latam!.postalAddress));
  assert.ok(!d.body.includes(COMPLIANCE_CONFIG.us!.postalAddress), "a Spanish email never carries the Florida address");
});

test("an unmapped market is never generated: no draft, member held with the unmapped-market reason", async () => {
  const { generateMissingDrafts } = await import("@/lib/sequences/draftQueries");
  const m = await mkMember("spain", { country: "Spain" });
  calls.length = 0;
  const result = await generateMissingDrafts(bdId, sequenceId, deps());
  assert.ok(result.ok && result.held.includes(m));
  assert.equal(calls.filter((c) => c.contact.firstName === "spain").length, 0);
  assert.equal(await draftOf(m), undefined);
  const row = await memberOf(m);
  assert.equal(row.holdReason, "unmapped_market");
  assert.ok(row.holdAt);
});

test("edit protection: an edited draft is byte-identical after a missing-drafts batch; the empty member is generated", async () => {
  const { generateMissingDrafts } = await import("@/lib/sequences/draftQueries");
  const edited = await mkMember("edited");
  const empty = await mkMember("empty");
  await setDraft(edited, { subject: "Mine", body: "My own words", editedAt: new Date(), editedByBdId: bdId });
  const before = await draftOf(edited);
  const result = await generateMissingDrafts(bdId, sequenceId, deps());
  assert.ok(result.ok && result.generated.includes(empty) && !result.generated.includes(edited) && !result.failed.includes(edited));
  assert.deepEqual(await draftOf(edited), before);
});

test("per-card generate creates that member's draft only: a sibling with no draft still has none, and an existing draft is untouched", async () => {
  const { generateMemberDraft } = await import("@/lib/sequences/draftQueries");
  const target = await mkMember("solotarget");
  const sibling = await mkMember("solosibling");
  const edited = await mkMember("soloedited");
  await setDraft(edited, { subject: "Mine", body: "My own words", editedAt: new Date(), editedByBdId: bdId });
  const before = await draftOf(edited);
  const result = await generateMemberDraft(bdId, sequenceId, target, deps());
  assert.ok(result.ok && result.generated.length === 1 && result.generated[0] === target);
  assert.match((await draftOf(target)).body, /^Hi solotarget,/);
  assert.equal(await draftOf(sibling), undefined, "no other member is generated");
  const again = await generateMemberDraft(bdId, sequenceId, edited, deps());
  assert.ok(again.ok && again.generated.length === 0 && again.skipped.includes(edited));
  assert.deepEqual(await draftOf(edited), before, "missing mode never overwrites");
  assert.deepEqual(await generateMemberDraft(otherBdId, sequenceId, sibling, deps()), { ok: false, error: "not_found" });
});

test("one generator failure leaves the rest drafted and the failed member retryable", async () => {
  const { generateMissingDrafts } = await import("@/lib/sequences/draftQueries");
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await mkMember(`iso${i}`));
  const result = await generateMissingDrafts(bdId, sequenceId, deps(["iso2"]));
  assert.ok(result.ok);
  assert.deepEqual(result.failed, [ids[2]]);
  assert.equal(await draftOf(ids[2]), undefined);
  for (const i of [0, 1, 3]) assert.ok(await draftOf(ids[i]));
  const retry = await generateMissingDrafts(bdId, sequenceId, deps());
  assert.ok(retry.ok && retry.generated.includes(ids[2]));
  assert.ok(await draftOf(ids[2]));
});

test("regenerate replaces an edited draft (for the exact text the BD confirmed), clears review and approval, and returns an approved member to drafted", async () => {
  const { regenerateDrafts } = await import("@/lib/sequences/draftQueries");
  const m = await mkMember("regen", { state: "approved" });
  const stamp = new Date();
  await setDraft(m, { editedAt: stamp, editedByBdId: bdId, reviewedAt: stamp, reviewedByBdId: bdId, approvedAt: stamp, approvedByBdId: bdId, scheduledFor: stamp });
  const result = await regenerateDrafts(bdId, sequenceId, [m], deps(), { [m]: stamp.getTime() });
  assert.ok(result.ok && result.generated.includes(m));
  const d = await draftOf(m);
  assert.match(d.body, /^Hi regen,/);
  assert.deepEqual([d.editedAt, d.editedByBdId, d.reviewedAt, d.approvedAt, d.approvedByBdId, d.scheduledFor], [null, null, null, null, null, null]);
  assert.equal((await memberOf(m)).state, "drafted");
});

test("regenerate without a confirmation skips an edited draft and reports it with the instant found; an unedited one is regenerated", async () => {
  const { regenerateDrafts } = await import("@/lib/sequences/draftQueries");
  const mine = await mkMember("keepmine");
  const auto = await mkMember("autoone");
  await setDraft(mine, { subject: "Mine", body: "My own words", editedAt: new Date(), editedByBdId: bdId });
  await setDraft(auto, { body: "auto text" });
  const before = await draftOf(mine);
  const result = await regenerateDrafts(bdId, sequenceId, [mine, auto], deps());
  assert.ok(result.ok);
  assert.deepEqual(result.skippedEdited, [{ memberId: mine, editedAt: before.editedAt!.getTime() }], "the report carries the instant of the text found");
  assert.ok(result.generated.includes(auto) && !result.generated.includes(mine));
  assert.deepEqual(await draftOf(mine), before);
  assert.match((await draftOf(auto)).body, /^Hi autoone,/);
});

test("a confirmation covers only the listed member and only the text it was shown", async () => {
  const { regenerateDrafts } = await import("@/lib/sequences/draftQueries");
  const shown = await mkMember("shownone");
  const unseen = await mkMember("unseenone");
  const t0 = new Date(Date.now() - 60_000);
  await setDraft(shown, { subject: "Mine", body: "shown text", editedAt: t0, editedByBdId: bdId });
  await setDraft(unseen, { subject: "Mine", body: "edited elsewhere", editedAt: t0, editedByBdId: bdId });
  // Only `shown` is confirmed: `unseen` is in the same call but was never shown to the BD, so it stays protected.
  const result = await regenerateDrafts(bdId, sequenceId, [shown, unseen], deps(), { [shown]: t0.getTime() });
  assert.ok(result.ok && result.generated.includes(shown));
  assert.deepEqual(result.skippedEdited.map((s) => s.memberId), [unseen]);
  assert.equal((await draftOf(unseen)).body, "edited elsewhere");
});

test("a confirmation older than the stored edit is refused: confirm means THAT text, not whatever is there when it lands", async () => {
  const { regenerateDrafts } = await import("@/lib/sequences/draftQueries");
  const m = await mkMember("staleconf");
  const seen = new Date(Date.now() - 120_000);
  const later = new Date(Date.now() - 30_000);
  await setDraft(m, { subject: "Mine", body: "edited again after the dialog", editedAt: later, editedByBdId: bdId });
  const result = await regenerateDrafts(bdId, sequenceId, [m], deps(), { [m]: seen.getTime() });
  assert.ok(result.ok && !result.generated.includes(m));
  assert.deepEqual(result.skippedEdited, [{ memberId: m, editedAt: later.getTime() }], "reported again with the newer instant so the dialog can show it");
  assert.equal((await draftOf(m)).body, "edited again after the dialog");
});

test("an edit committed after the early check but before the write is refused by the transaction", async () => {
  const { regenerateDrafts } = await import("@/lib/sequences/draftQueries");
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const m = await mkMember("racing");
  await setDraft(m, { body: "auto text" });
  const inner = generator([]);
  // The generator runs between the early check (draft still unedited) and the transaction: the BD saves an edit right there.
  const racing = async (...args: unknown[]) => {
    await db.update(sequenceDraft).set({ body: "saved in the meantime", editedAt: new Date(), editedByBdId: bdId }).where(eq(sequenceDraft.sequenceMemberId, m));
    return (inner as (...a: unknown[]) => unknown)(...args);
  };
  const result = await regenerateDrafts(bdId, sequenceId, [m], { generate: racing as never, siteUrl: "https://example.test" });
  assert.ok(result.ok && !result.generated.includes(m));
  assert.deepEqual(result.skippedEdited.map((s) => s.memberId), [m]);
  assert.equal((await draftOf(m)).body, "saved in the meantime");
});

test("regenerate never touches a sent or discarded member", async () => {
  const { regenerateDrafts } = await import("@/lib/sequences/draftQueries");
  const sent = await mkMember("sentone", { state: "sent" });
  const gone = await mkMember("goneone", { state: "discarded" });
  await setDraft(sent, { body: "what was sent" });
  await setDraft(gone, { body: "old" });
  const result = await regenerateDrafts(bdId, sequenceId, [sent, gone], deps());
  assert.ok(result.ok && result.skipped.length === 2);
  assert.equal((await draftOf(sent)).body, "what was sent");
  assert.equal((await draftOf(gone)).body, "old");
});

test("saving an edit stamps who and when, withdraws review and approval, and warns when the footer was removed", async () => {
  const { saveDraftEdit } = await import("@/lib/sequences/draftQueries");
  const { generateMissingDrafts } = await import("@/lib/sequences/draftQueries");
  const m = await mkMember("saver");
  await generateMissingDrafts(bdId, sequenceId, deps());
  const { db } = await import("@/db");
  const { sequenceDraft, sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const stamp = new Date();
  await db.update(sequenceDraft).set({ reviewedAt: stamp, approvedAt: stamp, approvedByBdId: bdId }).where(eq(sequenceDraft.sequenceMemberId, m));
  await db.update(sequenceMember).set({ state: "approved" }).where(eq(sequenceMember.id, m));
  const kept = (await draftOf(m)).body;

  const ok = await saveDraftEdit(bdId, m, { subject: "New subject", body: `${kept}\n\nP.S.` });
  assert.deepEqual(ok, { ok: true, footerWarning: false });
  let d = await draftOf(m);
  assert.equal(d.subject, "New subject");
  assert.ok(d.editedAt && d.editedByBdId === bdId);
  assert.deepEqual([d.reviewedAt, d.approvedAt, d.scheduledFor], [null, null, null]);
  assert.equal((await memberOf(m)).state, "drafted");

  const stripped = await saveDraftEdit(bdId, m, { subject: "New subject", body: "No footer here" });
  assert.deepEqual(stripped, { ok: true, footerWarning: true });
  d = await draftOf(m);
  assert.equal(d.body, "No footer here", "the save still goes through");
});

test("save rejects empty text and a sent member; another BD cannot draft or edit", async () => {
  const { saveDraftEdit, generateMissingDrafts, regenerateDrafts } = await import("@/lib/sequences/draftQueries");
  const m = await mkMember("guarded");
  await setDraft(m, { body: "B" });
  assert.deepEqual(await saveDraftEdit(bdId, m, { subject: " ", body: "x" }), { ok: false, error: "empty" });
  const sent = await mkMember("sentguard", { state: "sent" });
  await setDraft(sent, { body: "sent text" });
  assert.deepEqual(await saveDraftEdit(bdId, sent, { subject: "s", body: "b" }), { ok: false, error: "not_editable" });
  assert.equal((await draftOf(sent)).body, "sent text");
  assert.deepEqual(await saveDraftEdit(otherBdId, m, { subject: "s", body: "b" }), { ok: false, error: "not_found" });
  assert.deepEqual(await generateMissingDrafts(otherBdId, sequenceId, deps()), { ok: false, error: "not_found" });
  assert.deepEqual(await regenerateDrafts(otherBdId, sequenceId, [m], deps()), { ok: false, error: "not_found" });
});

async function stepDraft(memberId: string, step: number) {
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceDraft).where(and(eq(sequenceDraft.sequenceMemberId, memberId), eq(sequenceDraft.step, step))))[0];
}

async function tokenCount(memberId: string) {
  const { db } = await import("@/db");
  const { sequenceUnsubscribeToken } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceUnsubscribeToken).where(eq(sequenceUnsubscribeToken.sequenceMemberId, memberId))).length;
}

/** A member whose step 1 went out: state sent with a step 1 draft on file. */
async function mkSentMember(name: string, over: { country?: string } = {}) {
  const m = await mkMember(name, { ...over, state: "sent" });
  await setDraft(m, { body: "what was sent" });
  return m;
}

test("a reminder is drafted for a sent member: own prompt purpose, market language, footer, a NEW token, state untouched", async () => {
  const { generateReminderDraft } = await import("@/lib/sequences/draftQueries");
  const { COMPLIANCE_CONFIG } = await import("@/lib/sequences/config");
  const m = await mkSentMember("remus");
  const tokensBefore = await tokenCount(m);
  calls.length = 0;
  assert.equal(await generateReminderDraft(bdId, sequenceId, m, deps()), "generated");
  assert.deepEqual(calls.map((c) => [c.language, c.channel, c.purpose]), [["en", "email", "reminder"]]);
  const d = await stepDraft(m, 2);
  assert.match(d.body, /^Hi remus,/);
  assert.ok(d.body.includes(COMPLIANCE_CONFIG.us!.postalAddress));
  assert.match(d.body, /https:\/\/example\.test\/api\/unsubscribe\?t=\S+$/);
  assert.equal(await tokenCount(m), tokensBefore + 1);
  assert.equal((await stepDraft(m, 1)).body, "what was sent");
  assert.equal((await memberOf(m)).state, "sent");
});

test("a LATAM reminder is drafted in Spanish with the Argentina footer, never the Florida address", async () => {
  const { generateReminderDraft } = await import("@/lib/sequences/draftQueries");
  const { COMPLIANCE_CONFIG } = await import("@/lib/sequences/config");
  const m = await mkSentMember("remlatam", { country: "Argentina" });
  calls.length = 0;
  await generateReminderDraft(bdId, sequenceId, m, deps());
  assert.deepEqual(calls.map((c) => [c.language, c.purpose]), [["es", "reminder"]]);
  const d = await stepDraft(m, 2);
  assert.ok(d.body.includes(COMPLIANCE_CONFIG.latam!.postalAddress));
  assert.ok(!d.body.includes(COMPLIANCE_CONFIG.us!.postalAddress));
});

test("each reminder issues its own token; a second missing run neither regenerates nor adds a token", async () => {
  const { generateReminderDraft } = await import("@/lib/sequences/draftQueries");
  const m = await mkSentMember("remtok");
  await generateReminderDraft(bdId, sequenceId, m, deps());
  const afterFirst = await tokenCount(m);
  calls.length = 0;
  assert.equal(await generateReminderDraft(bdId, sequenceId, m, deps()), "skipped");
  assert.equal(calls.length, 0);
  assert.equal(await tokenCount(m), afterFirst);
  assert.equal(await generateReminderDraft(bdId, sequenceId, m, deps(), "regenerate"), "generated");
  assert.equal(await tokenCount(m), afterFirst + 1);
});

test("an edited reminder survives a missing run; regenerate replaces it and clears review and approval", async () => {
  const { generateReminderDraft } = await import("@/lib/sequences/draftQueries");
  const m = await mkSentMember("remedit");
  const stamp = new Date();
  await setDraft(m, { step: 2, subject: "Mine", body: "My own nudge", editedAt: stamp, editedByBdId: bdId, reviewedAt: stamp, approvedAt: stamp, approvedByBdId: bdId });
  const before = await stepDraft(m, 2);
  assert.equal(await generateReminderDraft(bdId, sequenceId, m, deps()), "skipped");
  assert.deepEqual(await stepDraft(m, 2), before);
  // The destructive capability needs the explicit argument at this level too: a mode string alone never destroys an edit.
  assert.equal(await generateReminderDraft(bdId, sequenceId, m, deps(), "regenerate"), "skipped");
  assert.deepEqual(await stepDraft(m, 2), before);
  assert.equal(await generateReminderDraft(bdId, sequenceId, m, deps(), "regenerate", { [m]: stamp.getTime() }), "generated");
  const d = await stepDraft(m, 2);
  assert.match(d.body, /^Hi remedit,/);
  assert.deepEqual([d.editedAt, d.editedByBdId, d.reviewedAt, d.approvedAt, d.approvedByBdId], [null, null, null, null, null]);
  assert.equal((await memberOf(m)).state, "sent");
});

test("no reminder without a sent step 1: drafted, replied and no_reply members, a member with no step 1 draft, and strangers are skipped", async () => {
  const { generateReminderDraft } = await import("@/lib/sequences/draftQueries");
  const drafted = await mkMember("remdrafted");
  await setDraft(drafted, {});
  const replied = await mkMember("remreplied", { state: "replied" });
  await setDraft(replied, {});
  const done = await mkMember("remdone", { state: "no_reply" });
  await setDraft(done, {});
  const noStep1 = await mkMember("remnostep1", { state: "sent" });
  const owned = await mkSentMember("remstranger");
  calls.length = 0;
  for (const id of [drafted, replied, done, noStep1]) assert.equal(await generateReminderDraft(bdId, sequenceId, id, deps()), "skipped");
  assert.equal(await generateReminderDraft(otherBdId, sequenceId, owned, deps()), "skipped");
  assert.equal(calls.length, 0);
  for (const id of [drafted, replied, done, noStep1, owned]) assert.equal(await stepDraft(id, 2), undefined);
});

test("a reminder for an unmapped market is held, never generated", async () => {
  const { generateReminderDraft } = await import("@/lib/sequences/draftQueries");
  const m = await mkSentMember("remspain", { country: "Spain" });
  calls.length = 0;
  assert.equal(await generateReminderDraft(bdId, sequenceId, m, deps()), "skipped");
  assert.equal(calls.length, 0);
  assert.equal(await stepDraft(m, 2), undefined);
  assert.equal((await memberOf(m)).holdReason, "unmapped_market");
});

test("a failed generation throws, leaves no reminder and issues no token, so the runner can retry", async () => {
  const { generateReminderDraft } = await import("@/lib/sequences/draftQueries");
  const m = await mkSentMember("remfail");
  const before = await tokenCount(m);
  await assert.rejects(generateReminderDraft(bdId, sequenceId, m, deps(["remfail"])), /generation failed/);
  assert.equal(await stepDraft(m, 2), undefined);
  assert.equal(await tokenCount(m), before);
});
