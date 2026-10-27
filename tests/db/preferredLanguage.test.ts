/**
 * DB-backed test for person.preferred_language, through the real write and read paths: the property edit (value, actor and
 * history row), the producers of the draft language that can be observed (the generator input and the footer it is composed with,
 * for step 1, a regeneration and the step 2 reminder; the Sequence detail the card reads; the unsubscribe page), the dialog's
 * "save as preferred" write, and the two things it must never do: move the legal address or unblock a held contact.
 * Not covered here: memberDraftSignals, which shares loadFacts and resolveDraftCompliance with the draft but returns signals that
 * do not depend on the language, so no assertion could tell it apart. The model is replaced by an injected generator. Scratch database only
 * (`npm run test:db` with DATABASE_URL on a local `_e2e` database); every row is created under a per-run token and removed after.
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
let accountId: string;
const personIds: string[] = [];

type Input = { language: string; contact: { firstName: string | null } };
const calls: Input[] = [];
const generate = async (input: Input) => {
  calls.push(input);
  return { ok: true as const, channel: "email" as const, message: "", subject: `Hello ${input.contact.firstName}`, body: `Hi ${input.contact.firstName},\n\nPitch in ${input.language}.\n\nCristian`, historyCount: 0, signals: [] };
};
const deps = { generate: generate as never, siteUrl: "https://example.test" };
const languagesFor = (first: string) => calls.filter((c) => c.contact.firstName === first).map((c) => c.language);

async function mkMember(name: string, over: { country?: string; preferred?: string } = {}) {
  const { db } = await import("@/db");
  const { person, sequenceMember } = await import("@/db/schema");
  const email = `${key(name)}@example.test`;
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", country: over.country ?? "United States", preferredLanguage: over.preferred ?? null }).returning();
  personIds.push(p.id);
  const [m] = await db.insert(sequenceMember).values({ sequenceId, personId: p.id, state: "drafted" }).returning();
  return { memberId: m.id, personId: p.id, email };
}

async function personRow(personId: string) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(person).where(eq(person.id, personId)))[0];
}

async function historyOf(personId: string) {
  const { db } = await import("@/db");
  const { personPropertyHistory } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  return db.select().from(personPropertyHistory).where(and(eq(personPropertyHistory.personId, personId), eq(personPropertyHistory.property, "preferredLanguage")));
}

async function memberOf(memberId: string) {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceMember).where(eq(sequenceMember.id, memberId)))[0];
}

async function draftOf(memberId: string) {
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceDraft).where(eq(sequenceDraft.sequenceMemberId, memberId)))[0];
}

before(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, sequence } = await import("@/db/schema");
  const [a] = await db.insert(bd).values({ name: "ZZ Preferrer", email: `zz-pref-${run}@example.test` }).returning();
  const [b] = await db.insert(bd).values({ name: "ZZ Stranger", email: `zz-pref-other-${run}@example.test` }).returning();
  bdId = a.id;
  otherBdId = b.id;
  const [acc] = await db.insert(emailAccount).values({ bdId, emailAddress: `zz-pref-sender-${run}@example.test` }).returning();
  accountId = acc.id;
  const [s] = await db.insert(sequence).values({ name: key("seq"), ownerBdId: bdId, emailAccountId: acc.id, schedule: {} }).returning();
  sequenceId = s.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, person, personPropertyHistory, sequence } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(sequence).where(inArray(sequence.ownerBdId, [bdId]));
  if (personIds.length) {
    await db.delete(personPropertyHistory).where(inArray(personPropertyHistory.personId, personIds));
    await db.delete(person).where(inArray(person.id, personIds));
  }
  await db.delete(emailAccount).where(inArray(emailAccount.bdId, [bdId, otherBdId]));
  await db.delete(bd).where(inArray(bd.id, [bdId, otherBdId]));
  await db.$client.end();
});

test("editing the property stores it, and the history row names the actor; Automático clears it with its own row", async () => {
  const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");
  const { personId } = await mkMember("edit");
  assert.equal((await personRow(personId)).preferredLanguage, null);

  await updateContactProperty(personId, "preferredLanguage", "es", bdId);
  assert.equal((await personRow(personId)).preferredLanguage, "es");
  await updateContactProperty(personId, "preferredLanguage", "", otherBdId);
  assert.equal((await personRow(personId)).preferredLanguage, null);

  const rows = (await historyOf(personId)).sort((x, y) => x.at.getTime() - y.at.getTime());
  assert.deepEqual(rows.map((r) => [r.oldValue, r.newValue, r.changedByBdId, r.source]), [[null, "es", bdId, "edit"], ["es", null, otherBdId, "edit"]]);
});

test("a value outside es / en is refused and writes neither the column nor a history row", async () => {
  const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");
  const { InvalidPreferredLanguageError } = await import("@/lib/contacts/propertyEdit");
  const { personId } = await mkMember("invalid");
  await assert.rejects(() => updateContactProperty(personId, "preferredLanguage", "pt", bdId), InvalidPreferredLanguageError);
  assert.equal((await personRow(personId)).preferredLanguage, null);
  assert.equal((await historyOf(personId)).length, 0);
});

test("correcting the contact's own country keeps the preference", async () => {
  const { updateContactProperty, updateContactProperties } = await import("@/lib/contacts/propertyEditDb");
  const { personId } = await mkMember("country");
  await updateContactProperty(personId, "preferredLanguage", "es", bdId);
  await updateContactProperties(personId, { city: "", region: "", country: "Argentina" }, bdId);
  const row = await personRow(personId);
  assert.equal(row.country, "Argentina");
  assert.equal(row.preferredLanguage, "es");
});

test("PRODUCER draft: a US contact with español preferred is drafted in Spanish, with the Miami address and the Spanish opt-out sentence", async () => {
  const { generateMemberDraft } = await import("@/lib/sequences/draftQueries");
  const { COMPLIANCE_CONFIG, OPT_OUT_TEXT } = await import("@/lib/sequences/config");
  const plain = await mkMember("usplain");
  const preferred = await mkMember("uspref", { preferred: "es" });
  calls.length = 0;
  await generateMemberDraft(bdId, sequenceId, plain.memberId, deps);
  await generateMemberDraft(bdId, sequenceId, preferred.memberId, deps);
  assert.deepEqual([languagesFor("usplain"), languagesFor("uspref")], [["en"], ["es"]]);
  const body = (await draftOf(preferred.memberId)).body;
  assert.ok(body.includes(COMPLIANCE_CONFIG.miami!.postalAddress) && !body.includes(COMPLIANCE_CONFIG.mdp!.postalAddress), "the address still follows where the recipient is");
  assert.ok(body.includes(OPT_OUT_TEXT.es) && !body.includes(OPT_OUT_TEXT.en), "the opt-out sentence follows the draft language");
});

/** A second Sequence of the same owner holding the same person: the one-off lives on the member, the preference on the person. */
async function mkOtherMembership(personId: string) {
  const { db } = await import("@/db");
  const { sequence, sequenceMember } = await import("@/db/schema");
  const [s] = await db.insert(sequence).values({ name: key("seq2"), ownerBdId: bdId, emailAccountId: accountId, schedule: {} }).returning();
  const [m] = await db.insert(sequenceMember).values({ sequenceId: s.id, personId, state: "drafted" }).returning();
  return { sequenceId: s.id, memberId: m.id };
}

test("PRODUCER draft: a one-off choice beats the preference for that member only, and regenerating reuses it", async () => {
  const { generateMemberDraft, regenerateDrafts, setMemberDraftLanguage } = await import("@/lib/sequences/draftQueries");
  const m = await mkMember("oneoff", { preferred: "es" });
  const elsewhere = await mkOtherMembership(m.personId);
  assert.deepEqual(await setMemberDraftLanguage(bdId, m.memberId, "en"), { ok: true });
  calls.length = 0;
  await generateMemberDraft(bdId, sequenceId, m.memberId, deps);
  await regenerateDrafts(bdId, sequenceId, [m.memberId], deps);
  assert.deepEqual(languagesFor("oneoff"), ["en", "en"]);
  // The same person in another Sequence has no one-off there, so the preference applies to that draft.
  calls.length = 0;
  await generateMemberDraft(bdId, elsewhere.sequenceId, elsewhere.memberId, deps);
  assert.deepEqual(languagesFor("oneoff"), ["es"]);
  calls.length = 0;
  await setMemberDraftLanguage(bdId, m.memberId, null);
  await regenerateDrafts(bdId, sequenceId, [m.memberId], deps);
  assert.deepEqual(languagesFor("oneoff"), ["es"], "clearing the one-off falls back to the preference");
});

test("SAFETY: a preferred language never unblocks a held contact", async () => {
  const { generateMemberDraft, setMemberPreferredLanguage } = await import("@/lib/sequences/draftQueries");
  const held = await mkMember("held", { country: "Cuba", preferred: "es" });
  calls.length = 0;
  const result = await generateMemberDraft(bdId, sequenceId, held.memberId, deps);
  assert.ok(result.ok && result.held.includes(held.memberId));
  assert.equal(languagesFor("held").length, 0);
  assert.equal(await draftOf(held.memberId), undefined);
  assert.equal((await memberOf(held.memberId)).holdReason, "unmapped_market");
  assert.deepEqual(await setMemberPreferredLanguage(bdId, held.memberId, "en"), { ok: false, error: "held" });
  assert.equal((await personRow(held.personId)).preferredLanguage, "es", "a refused save writes nothing");
});

test("PRODUCER Sequence detail: the card reads the preference with who set it and when, and nothing for Automático", async () => {
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");
  const { memberLanguage } = await import("@/lib/sequences/audienceCard");
  const auto = await mkMember("cardauto");
  const set = await mkMember("cardset");
  const unstamped = await mkMember("cardunstamped", { preferred: "en" }); // set by SQL or an import: no history row
  await updateContactProperty(set.personId, "preferredLanguage", "es", bdId);
  const detail = await getSequenceDetail({ id: bdId, role: "bd" }, sequenceId);
  const byId = new Map(detail!.members.map((m) => [m.memberId, m]));
  const a = byId.get(auto.memberId)!;
  const s = byId.get(set.memberId)!;
  assert.equal(a.preferredLanguage, null);
  assert.deepEqual(byId.get(unstamped.memberId)!.preferredLanguage, { language: "en", byName: null, at: null }, "no history row: nobody and no date to quote");
  assert.equal(memberLanguage(a)!.source, "audience");
  assert.equal(s.preferredLanguage?.language, "es");
  assert.equal(s.preferredLanguage?.byName, "ZZ Preferrer");
  assert.ok(s.preferredLanguage?.at instanceof Date && Math.abs(Date.now() - s.preferredLanguage.at.getTime()) < 60_000);
  assert.deepEqual([memberLanguage(s)!.language, memberLanguage(s)!.source, s.audience?.audience?.language], ["es", "preferred", "en"], "the card says español preferido while the audience alone would say inglés");
});

test("PRODUCER unsubscribe page: the page speaks the language the email was written in", async () => {
  const { issueUnsubscribeToken, unsubscribeAudienceForToken } = await import("@/lib/sequences/unsubscribeQueries");
  const { hashUnsubscribeToken } = await import("@/lib/sequences/unsubscribeToken");
  const plain = await mkMember("unsubplain");
  const preferred = await mkMember("unsubpref", { preferred: "es" });
  const pageFor = async (m: { memberId: string; email: string }) => unsubscribeAudienceForToken(hashUnsubscribeToken(await issueUnsubscribeToken({ sequenceMemberId: m.memberId, email: m.email })));
  const [plainPage, preferredPage] = [await pageFor(plain), await pageFor(preferred)];
  assert.equal(plainPage?.locale, "en");
  assert.equal(preferredPage?.locale, "es");
  assert.equal(preferredPage?.postalAddress, plainPage?.postalAddress);
});

test("saving as preferred sets the property with the actor, drops this member's one-off, generates nothing, and is owner-checked", async () => {
  const { setMemberDraftLanguage, setMemberPreferredLanguage } = await import("@/lib/sequences/draftQueries");
  const m = await mkMember("saveas");
  await setMemberDraftLanguage(bdId, m.memberId, "es");
  calls.length = 0;
  assert.deepEqual(await setMemberPreferredLanguage(otherBdId, m.memberId, "es"), { ok: false, error: "not_found" });
  assert.equal((await personRow(m.personId)).preferredLanguage, null, "a stranger's save writes nothing");

  assert.deepEqual(await setMemberPreferredLanguage(bdId, m.memberId, "es"), { ok: true, personId: m.personId });
  assert.equal((await personRow(m.personId)).preferredLanguage, "es");
  const member = await memberOf(m.memberId);
  assert.deepEqual([member.draftLanguage, member.draftLanguageByBdId, member.draftLanguageAt], [null, null, null]);
  assert.deepEqual((await historyOf(m.personId)).map((r) => [r.oldValue, r.newValue, r.changedByBdId]), [[null, "es", bdId]]);
  assert.equal(calls.length, 0, "saving the preference calls no generator");
  assert.equal(await draftOf(m.memberId), undefined, "and writes no draft");
});

test("changing the preference leaves an existing draft exactly as it was", async () => {
  const { generateMemberDraft, setMemberPreferredLanguage } = await import("@/lib/sequences/draftQueries");
  const m = await mkMember("keepdraft");
  await generateMemberDraft(bdId, sequenceId, m.memberId, deps);
  const before = await draftOf(m.memberId);
  calls.length = 0;
  await setMemberPreferredLanguage(bdId, m.memberId, "es");
  assert.deepEqual(await draftOf(m.memberId), before);
  assert.equal(calls.length, 0);
});

test("PRODUCER step 2 reminder: stays in the language step 1 was written in even when the preference changed since, with that language's opt-out sentence", async () => {
  const { db } = await import("@/db");
  const { sequenceDraft, sequenceMember } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { generateMemberDraft, generateReminderDraft } = await import("@/lib/sequences/draftQueries");
  const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");
  const { OPT_OUT_TEXT } = await import("@/lib/sequences/config");
  const m = await mkMember("reminder");
  calls.length = 0;
  await generateMemberDraft(bdId, sequenceId, m.memberId, deps);
  await db.update(sequenceMember).set({ state: "sent" }).where(eq(sequenceMember.id, m.memberId));
  await updateContactProperty(m.personId, "preferredLanguage", "es", bdId);
  assert.equal(await generateReminderDraft(bdId, sequenceId, m.memberId, deps), "generated");
  assert.deepEqual(languagesFor("reminder"), ["en", "en"], "step 1 went out in the audience's language, and the reminder is pinned to it: a thread never mixes languages");
  const [reminder] = await db.select().from(sequenceDraft).where(and(eq(sequenceDraft.sequenceMemberId, m.memberId), eq(sequenceDraft.step, 2)));
  assert.ok(reminder.body.includes(OPT_OUT_TEXT.en) && !reminder.body.includes(OPT_OUT_TEXT.es));
  assert.equal(reminder.language, "en");
});
