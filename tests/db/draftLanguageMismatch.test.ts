/**
 * DB-backed tests for the wrong-language draft rule, through the real paths: generation stores the language, single and bulk
 * approval refuse a draft in another language than today's, "Mantener" writes the one-off choice, the reminder follows step 1's
 * language, and the release re-check holds an approved-but-unsent draft. The model and Gmail are counting fakes. Opt-in and
 * fail-closed: `npm run test:db`, DATABASE_URL naming a `*_e2e` database on loopback. Rows live under a per-run token.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const NOW = new Date("2026-10-15T14:00:00Z");
const DUE = new Date("2026-10-15T13:00:00Z");
let bdId: string;
let accountId: string;
let sequenceId: string;
const personIds: string[] = [];

type Input = { language: string; purpose?: string; contact: { firstName: string | null } };
const calls: Input[] = [];
const deps = {
  siteUrl: "https://example.test",
  generate: (async (input: Input) => {
    calls.push(input);
    return { ok: true as const, channel: "email" as const, message: "", subject: `Hello ${input.contact.firstName}`, body: `Hi ${input.contact.firstName}, in ${input.language}.`, historyCount: 0, signals: [] };
  }) as never,
};

/** A body from the real footer producer, in the language the draft is stored with. */
async function footedBody(language: "es" | "en" = "en") {
  const { appendFooter } = await import("@/lib/sequences/complianceFooter");
  const { COMPLIANCE_CONFIG } = await import("@/lib/sequences/config");
  const { buildUnsubscribeUrl, generateUnsubscribeToken } = await import("@/lib/sequences/unsubscribeToken");
  const r = appendFooter("Hello there", COMPLIANCE_CONFIG, "miami", language, buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken()));
  assert.equal(r.status, "ok");
  return r.status === "ok" ? r.body : "";
}

type Over = { state?: string; country?: string; draftLanguage?: string | null; chosen?: "es" | "en"; preferred?: "es" | "en"; reviewed?: boolean; approved?: boolean; step1Language?: string | null; reminder?: boolean; noDraft?: boolean; hold?: string };
/** The default person is in the United States, so today's language is English. */
async function mkMember(name: string, over: Over = {}) {
  const { db } = await import("@/db");
  const { person, sequenceDraft, sequenceMember } = await import("@/db/schema");
  const email = `zz-${run}-${name}@example.test`;
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", country: over.country ?? "United States", preferredLanguage: over.preferred ?? null }).returning();
  personIds.push(p.id);
  const sentStep2 = over.reminder === true;
  const [m] = await db.insert(sequenceMember).values({
    sequenceId, personId: p.id, state: over.state ?? (sentStep2 ? "sent" : "drafted"),
    ...(over.chosen ? { draftLanguage: over.chosen, draftLanguageByBdId: bdId, draftLanguageAt: new Date() } : {}),
    ...(over.hold ? { holdReason: over.hold, holdAt: new Date() } : {}),
    ...(sentStep2 ? { sentAt: new Date("2026-10-08T13:00:00Z"), reminderDueAt: DUE } : {}),
  }).returning();
  const stamp = over.approved ? { approvedAt: new Date("2026-10-14T20:00:00Z"), approvedByBdId: bdId, scheduledFor: DUE } : {};
  const language = over.draftLanguage === undefined ? "en" : over.draftLanguage;
  if (sentStep2) await db.insert(sequenceDraft).values({ sequenceMemberId: m.id, step: 1, subject: "S1", body: "what was sent", language: over.step1Language === undefined ? "en" : over.step1Language });
  if (!over.noDraft) await db.insert(sequenceDraft).values({ sequenceMemberId: m.id, step: sentStep2 ? 2 : 1, subject: `Hello ${name}`, body: await footedBody((language ?? "en") as "es" | "en"), language, reviewedAt: over.reviewed ? new Date() : null, ...stamp });
  return { memberId: m.id, personId: p.id, email };
}

async function draftOf(memberId: string, step = 1) {
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceDraft).where(and(eq(sequenceDraft.sequenceMemberId, memberId), eq(sequenceDraft.step, step))))[0];
}
async function memberRow(memberId: string) {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceMember).where(eq(sequenceMember.id, memberId)))[0];
}
async function untouched(m: { memberId: string }, state: string, step = 1) {
  const d = await draftOf(m.memberId, step);
  assert.deepEqual([d.approvedAt, d.approvedByBdId, d.scheduledFor], [null, null, null]);
  assert.equal((await memberRow(m.memberId)).state, state);
}

before(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, sequence } = await import("@/db/schema");
  const [a] = await db.insert(bd).values({ name: "ZZ Language", email: `zz-lang-${run}@example.test` }).returning();
  bdId = a.id;
  const [acc] = await db.insert(emailAccount).values({ bdId, emailAddress: `zz-lang-sender-${run}@example.test`, lastSyncedAt: NOW }).returning();
  accountId = acc.id;
  const [s] = await db.insert(sequence).values({ name: `zz-${run}-seq`, ownerBdId: bdId, emailAccountId: accountId, schedule: {} }).returning();
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
  await db.delete(auditLog).where(inArray(auditLog.actorBdId, [bdId]));
  await db.delete(emailAccount).where(inArray(emailAccount.bdId, [bdId]));
  await db.delete(bd).where(inArray(bd.id, [bdId]));
});

// --- generation stores the language ---------------------------------------------------------------------------------

test("generation, regeneration and the reminder store the language the draft was composed in", async () => {
  const { generateMemberDraft, generateReminderDraft, regenerateDrafts, setMemberDraftLanguage } = await import("@/lib/sequences/draftQueries");
  const us = await mkMember("gen-us", { noDraft: true });
  const ar = await mkMember("gen-ar", { country: "Argentina", noDraft: true });
  for (const m of [us, ar]) await generateMemberDraft(bdId, sequenceId, m.memberId, deps);
  assert.deepEqual([(await draftOf(us.memberId)).language, (await draftOf(ar.memberId)).language], ["en", "es"]);
  // A one-off choice, then regenerate: the stored language follows what was composed, not what it was.
  assert.deepEqual(await setMemberDraftLanguage(bdId, us.memberId, "es"), { ok: true });
  await regenerateDrafts(bdId, sequenceId, [us.memberId], deps);
  assert.equal((await draftOf(us.memberId)).language, "es");
  // The reminder: stored too.
  const sent = await mkMember("gen-rem", { reminder: true, noDraft: true });
  assert.equal(await generateReminderDraft(bdId, sequenceId, sent.memberId, deps), "generated");
  assert.equal((await draftOf(sent.memberId, 2)).language, "en");
});

test("the reminder is pinned to step 1's language, on first draft and on Regenerar, even against the country and a preference", async () => {
  const { generateReminderDraft, regenerateReminderDraft } = await import("@/lib/sequences/draftQueries");
  // Argentina + a preference for Spanish resolve to Spanish today, but step 1 went out in English.
  const m = await mkMember("pin", { reminder: true, country: "Argentina", preferred: "es", step1Language: "en", noDraft: true });
  calls.length = 0;
  assert.equal(await generateReminderDraft(bdId, sequenceId, m.memberId, deps), "generated");
  assert.deepEqual(calls.map((c) => c.language), ["en"]);
  const d = await draftOf(m.memberId, 2);
  assert.equal(d.language, "en");
  const { OPT_OUT_TEXT } = await import("@/lib/sequences/config");
  assert.ok(d.body.includes(OPT_OUT_TEXT.en) && !d.body.includes(OPT_OUT_TEXT.es), "the footer sentence follows the pin too");
  calls.length = 0;
  assert.deepEqual(await regenerateReminderDraft(bdId, sequenceId, m.memberId, deps), { ok: true, held: [], skippedEdited: [], generated: [m.memberId], skipped: [], failed: [], reasons: {} });
  assert.deepEqual(calls.map((c) => c.language), ["en"], "Regenerar on a reminder follows the pin");
  // With step 1's language unknown nothing is pinned: the resolver decides, as before.
  const legacy = await mkMember("pin-legacy", { reminder: true, country: "Argentina", step1Language: null, noDraft: true });
  calls.length = 0;
  await generateReminderDraft(bdId, sequenceId, legacy.memberId, deps);
  assert.deepEqual(calls.map((c) => c.language), ["es"]);
});

// --- approval -------------------------------------------------------------------------------------------------------

test("single approval refuses a draft in another language than today's as wrong_language, and writes nothing", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const m = await mkMember("single-wrong", { draftLanguage: "es" });
  assert.deepEqual(await approveMember(bdId, m.memberId), { ok: false, error: "rejected", rejected: [{ memberId: m.memberId, reason: "wrong_language" }] });
  await untouched(m, "drafted");
});

test("a matching draft and a draft of unknown language approve as before", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const match = await mkMember("single-match", { draftLanguage: "en" });
  const unknown = await mkMember("single-unknown", { draftLanguage: null });
  assert.deepEqual(await approveMember(bdId, match.memberId), { ok: true, approved: [match.memberId] });
  assert.deepEqual(await approveMember(bdId, unknown.memberId), { ok: true, approved: [unknown.memberId] });
});

test("today's language is the resolver's: a preferred language loaded after generating flags the draft", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const m = await mkMember("pref-late", { draftLanguage: "en", preferred: "es" });
  const r = await approveMember(bdId, m.memberId);
  assert.ok(!r.ok && r.error === "rejected" && r.rejected[0]?.reason === "wrong_language");
});

test("'Mantener' writes the one-off choice with who and when, and the draft then approves normally", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const { keepDraftLanguage } = await import("@/lib/sequences/draftQueries");
  const m = await mkMember("keep", { draftLanguage: "es" });
  const textBefore = (await draftOf(m.memberId)).body;
  assert.ok(!(await approveMember(bdId, m.memberId)).ok);
  assert.deepEqual(await keepDraftLanguage(bdId, m.memberId), { ok: true, language: "es" });
  const row = await memberRow(m.memberId);
  assert.deepEqual([row.draftLanguage, row.draftLanguageByBdId], ["es", bdId]);
  assert.ok(row.draftLanguageAt instanceof Date);
  assert.equal((await draftOf(m.memberId)).body, textBefore, "the text itself is untouched");
  assert.deepEqual(await approveMember(bdId, m.memberId), { ok: true, approved: [m.memberId] });
});

test("'Mantener' reads the STORED language and refuses a stale tab: the draft was regenerated elsewhere and now matches, so nothing is written", async () => {
  const { keepDraftLanguage } = await import("@/lib/sequences/draftQueries");
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const m = await mkMember("keep-stale", { draftLanguage: "es" });
  // The tab still shows the draft in Spanish, but it was regenerated in English (today's language) in another tab.
  await db.update(sequenceDraft).set({ language: "en" }).where(eq(sequenceDraft.id, (await draftOf(m.memberId)).id));
  assert.deepEqual(await keepDraftLanguage(bdId, m.memberId), { ok: false, error: "no_mismatch" });
  assert.deepEqual([(await memberRow(m.memberId)).draftLanguage, (await memberRow(m.memberId)).draftLanguageAt], [null, null], "no redundant one-off");
});

test("'Mantener' refuses an unknown draft language, a stranger's member and a member with no audience", async () => {
  const { keepDraftLanguage } = await import("@/lib/sequences/draftQueries");
  const unknown = await mkMember("keep-unknown", { draftLanguage: null });
  assert.deepEqual(await keepDraftLanguage(bdId, unknown.memberId), { ok: false, error: "no_mismatch" });
  const mine = await mkMember("keep-foreign", { draftLanguage: "es" });
  assert.deepEqual(await keepDraftLanguage(randomUUID(), mine.memberId), { ok: false, error: "not_found" });
  const nowhere = await mkMember("keep-nowhere", { country: "Cuba", draftLanguage: "es" });
  assert.deepEqual(await keepDraftLanguage(bdId, nowhere.memberId), { ok: false, error: "held" });
  for (const m of [unknown, mine, nowhere]) assert.equal((await memberRow(m.memberId)).draftLanguage, null);
});

test("bulk approval is all-or-nothing: one selected draft in another language refuses the whole request", async () => {
  const { approveBulk } = await import("@/lib/sequences/approvalQueries");
  const good = await mkMember("bulk-good", { reviewed: true });
  const wrong = await mkMember("bulk-wrong", { reviewed: true, draftLanguage: "es" });
  assert.deepEqual(await approveBulk(bdId, [good.memberId, wrong.memberId]), { ok: false, error: "rejected", rejected: [{ memberId: wrong.memberId, reason: "wrong_language" }] });
  await untouched(good, "drafted");
  await untouched(wrong, "drafted");
  assert.deepEqual(await approveBulk(bdId, [good.memberId]), { ok: true, approved: [good.memberId] }, "left out of the selection, the rest still approves");
});

test("bulk keeps its review gate: an unopened draft still refuses even when the language matches", async () => {
  const { approveBulk } = await import("@/lib/sequences/approvalQueries");
  const unopened = await mkMember("bulk-unopened");
  assert.deepEqual(await approveBulk(bdId, [unopened.memberId]), { ok: false, error: "rejected", rejected: [{ memberId: unopened.memberId, reason: "unreviewed" }] });
});

test("the reminder is measured against step 1's language when it is approved", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  // Mexico resolves to Spanish under the Miami address (the fixture footer), but step 1 went out in English: a Spanish reminder is the mixed thread the pin prevents.
  const mixed = await mkMember("rem-mixed", { reminder: true, country: "Mexico", step1Language: "en", draftLanguage: "es" });
  const r = await approveMember(bdId, mixed.memberId, 2);
  assert.ok(!r.ok && r.error === "rejected" && r.rejected[0]?.reason === "wrong_language");
  const pinned = await mkMember("rem-pinned", { reminder: true, country: "Mexico", step1Language: "en", draftLanguage: "en" });
  assert.equal((await approveMember(bdId, pinned.memberId, 2)).ok, true, "the pinned reminder is not measured against the country");
});

// --- release re-check ----------------------------------------------------------------------------------------------------

/** The real runner and the real ports, narrowed to these members, with a counting fake instead of Gmail. */
async function releaseOnly(memberIds: string[]) {
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const { liveRunnerPorts } = await import("@/lib/sequences/releaseQueries");
  const mine = new Set(memberIds);
  const sent: string[] = [];
  const ports = {
    ...liveRunnerPorts,
    now: () => NOW,
    load: async (now: Date) => {
      const loaded = await liveRunnerPorts.load(now);
      return { ...loaded, candidates: loaded.candidates.filter((c) => mine.has(c.id)) };
    },
    send: async (c: { id: string }) => (sent.push(c.id), { messageId: `g-${run}-${sent.length}`, threadId: `t-${run}-${sent.length}` }),
    draftReminder: async () => {},
  };
  return { summary: await runSequenceRelease(ports), sent };
}

test("the release re-check holds an approved-but-unsent draft in another language, and sends the one that matches", async () => {
  const wrong = await mkMember("rel-wrong", { state: "approved", approved: true, draftLanguage: "es" });
  const fine = await mkMember("rel-fine", { state: "approved", approved: true, draftLanguage: "en" });
  const { summary, sent } = await releaseOnly([wrong.memberId, fine.memberId]);
  assert.deepEqual(summary, { released: 1, held: 1, deferred: 0, failed: 0 });
  assert.deepEqual(sent, [fine.memberId]);
  const row = await memberRow(wrong.memberId);
  assert.deepEqual([row.holdReason, row.state], ["wrong_language", "approved"]);
});

test("the release re-check judges against a ONE-OFF choice made after approval: the draft is en, a person chose es", async () => {
  const m = await mkMember("rel-oneoff", { state: "approved", approved: true, draftLanguage: "en", chosen: "es" });
  const { summary, sent } = await releaseOnly([m.memberId]);
  assert.deepEqual([summary.held, summary.released, sent], [1, 0, []]);
  assert.equal((await memberRow(m.memberId)).holdReason, "wrong_language");
});

test("the release re-check judges against a PREFERRED language loaded after approval", async () => {
  const m = await mkMember("rel-pref", { state: "approved", approved: true, draftLanguage: "en", preferred: "es" });
  const { summary, sent } = await releaseOnly([m.memberId]);
  assert.deepEqual([summary.held, summary.released, sent], [1, 0, []]);
  assert.equal((await memberRow(m.memberId)).holdReason, "wrong_language");
});

test("the release re-check holds a REMINDER that is not in step 1's language, and the country does not decide it", async () => {
  // Mexico resolves to Spanish. Step 1 went out in English, so a Spanish reminder is the mixed thread; an English one is not held for language.
  const mixed = await mkMember("rel-rem-mixed", { reminder: true, approved: true, country: "Mexico", step1Language: "en", draftLanguage: "es" });
  const pinned = await mkMember("rel-rem-pinned", { reminder: true, approved: true, country: "Mexico", step1Language: "en", draftLanguage: "en" });
  const { sent } = await releaseOnly([mixed.memberId, pinned.memberId]);
  assert.deepEqual(sent, []);
  assert.equal((await memberRow(mixed.memberId)).holdReason, "wrong_language");
  assert.notEqual((await memberRow(pinned.memberId)).holdReason, "wrong_language", "held for something else (no thread headers in this fixture), not for language");
});

// --- a hold belongs to the approval it was written against ---------------------------------------------------------------

test("withdrawing the approval clears the release hold: cancel, edit and regenerate each return the card to a clean draft", async () => {
  const { cancelApproval } = await import("@/lib/sequences/approvalQueries");
  const { regenerateDrafts, saveDraftEdit } = await import("@/lib/sequences/draftQueries");
  const held = () => mkMember(`hold-${randomUUID().slice(0, 4)}`, { state: "approved", approved: true, hold: "wrong_language" });
  const cancelled = await held();
  assert.deepEqual(await cancelApproval(bdId, cancelled.memberId), { ok: true });
  const edited = await held();
  assert.equal((await saveDraftEdit(bdId, edited.memberId, { subject: "S", body: "B" })).ok, true);
  const regenerated = await held();
  await regenerateDrafts(bdId, sequenceId, [regenerated.memberId], deps);
  for (const m of [cancelled, edited, regenerated]) {
    const row = await memberRow(m.memberId);
    assert.deepEqual([row.state, row.holdReason, row.holdAt], ["drafted", null, null]);
  }
});

test("withdrawing a reminder's approval clears its hold too, and the member stays sent", async () => {
  const { cancelApproval } = await import("@/lib/sequences/approvalQueries");
  const m = await mkMember("hold-rem", { reminder: true, approved: true, hold: "wrong_language" });
  assert.deepEqual(await cancelApproval(bdId, m.memberId, 2), { ok: true });
  const row = await memberRow(m.memberId);
  assert.deepEqual([row.state, row.holdReason], ["sent", null]);
});

// --- the unsubscribe page follows the same pin ---------------------------------------------------------------------------

test("the unsubscribe page of a pinned reminder is in step 1's language, not the country's; an unknown step 1 changes nothing", async () => {
  const { issueUnsubscribeToken, unsubscribeAudienceForToken } = await import("@/lib/sequences/unsubscribeQueries");
  const { hashUnsubscribeToken } = await import("@/lib/sequences/unsubscribeToken");
  const localeOf = async (m: { memberId: string; email: string }) => (await unsubscribeAudienceForToken(hashUnsubscribeToken(await issueUnsubscribeToken({ sequenceMemberId: m.memberId, email: m.email }))))?.locale;
  // Argentina resolves to Spanish today, but step 1 went out in English: its reminder's link opens in English.
  const pinned = await mkMember("unsub-pinned", { reminder: true, country: "Argentina", step1Language: "en" });
  assert.equal(await localeOf(pinned), "en");
  const legacy = await mkMember("unsub-legacy", { reminder: true, country: "Argentina", step1Language: null });
  assert.equal(await localeOf(legacy), "es");
  // Step 1 not sent yet: nothing is pinned, the link is in the language of today.
  const unsent = await mkMember("unsub-unsent", { country: "Argentina", draftLanguage: "en" });
  assert.equal(await localeOf(unsent), "es");
});
