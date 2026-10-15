/**
 * DB-backed tests for the reads behind the Sequence pages (pageQueries.ts) and the sidebar's sequence_count. Opt-in and
 * fail-closed like the other sequence DB tests (`npm run test:db`, database name ending in `_e2e`). Every row is
 * synthetic and tagged with a per-run token.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const key = (name: string) => `zz-${run}-${name}`;
let ownerId: string;
let otherId: string;
let accountId: string;
let otherAccountId: string;
let sequenceId: string;
let otherSequenceId: string;
const personIds: string[] = [];
const companyKeys: string[] = [];
const sequenceIds: string[] = [];

async function mkCompany(name: string, over: { clientStatus?: string; postings?: boolean } = {}) {
  const { db } = await import("@/db");
  const { company, jobPosting, targetCompany } = await import("@/db/schema");
  const ck = key(`co-${name}`);
  companyKeys.push(ck);
  await db.insert(company).values({ companyKey: ck, displayName: ck, clientStatus: over.clientStatus ?? null });
  await db.insert(targetCompany).values({ companyKey: ck, displayName: ck, ats: "lever", config: {} });
  if (over.postings !== false) {
    await db.insert(jobPosting).values({ companyKey: ck, externalId: "1", title: "Engineer", location: "Miami, FL", url: "https://example.test", isIt: true, market: "us", isMiami: true });
  }
  return ck;
}

async function mkPerson(name: string, ck: string | null, over: { email?: string | null; emailStatus?: string; mergedIntoId?: string; company?: string | null } = {}) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const email = over.email === undefined ? `${key(name)}@example.test` : over.email;
  const [p] = await db
    .insert(person)
    .values({ firstName: name, lastName: run, email, emailNormalized: email?.toLowerCase().trim() ?? null, emailStatus: over.emailStatus ?? "verified", emailSource: "apollo", company: over.company === undefined ? ck : over.company, companyKey: ck, mergedIntoId: over.mergedIntoId })
    .returning();
  personIds.push(p.id);
  return p;
}

async function mkMember(seq: string, personId: string, state: string, over: { draft?: boolean; discardReason?: string } = {}) {
  const { db } = await import("@/db");
  const { sequenceDraft, sequenceMember } = await import("@/db/schema");
  const [m] = await db.insert(sequenceMember).values({ sequenceId: seq, personId, state, discardReason: over.discardReason ?? null }).returning();
  if (over.draft) await db.insert(sequenceDraft).values({ sequenceMemberId: m.id, step: 1, subject: "S", body: "B" });
  return m;
}

before(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, sequence } = await import("@/db/schema");
  const mk = async (n: string) => (await db.insert(bd).values({ name: `ZZ ${n}`, email: `zz-pages-${n}-${run}@example.test`, role: "bd" }).returning())[0].id;
  ownerId = await mk("owner");
  otherId = await mk("other");
  accountId = (await db.insert(emailAccount).values({ bdId: ownerId, emailAddress: `zz-pages-sender-${run}@example.test` }).returning())[0].id;
  otherAccountId = (await db.insert(emailAccount).values({ bdId: otherId, emailAddress: `zz-pages-other-${run}@example.test`, status: "revoked" }).returning())[0].id;
  sequenceId = (await db.insert(sequence).values({ name: key("seq"), ownerBdId: ownerId, emailAccountId: accountId, schedule: {} }).returning())[0].id;
  otherSequenceId = (await db.insert(sequence).values({ name: key("other-seq"), ownerBdId: otherId, emailAccountId: otherAccountId, schedule: {} }).returning())[0].id;
  sequenceIds.push(sequenceId, otherSequenceId);
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, emailAccount, emailMessage, emailSuppression, person, sequence, targetCompany } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(emailMessage).where(inArray(emailMessage.bdId, [ownerId, otherId]));
  await db.delete(sequence).where(inArray(sequence.id, sequenceIds));
  await db.delete(emailSuppression).where(inArray(emailSuppression.personId, personIds));
  await db.delete(person).where(inArray(person.id, personIds));
  await db.delete(targetCompany).where(inArray(targetCompany.companyKey, companyKeys));
  await db.delete(company).where(inArray(company.companyKey, companyKeys));
  await db.delete(emailAccount).where(inArray(emailAccount.bdId, [ownerId, otherId]));
  await db.delete(bd).where(inArray(bd.id, [ownerId, otherId]));
  await db.$client.end();
});

test("the sending account is the connected one; a revoked account is no account", async () => {
  const { getSendingAccount } = await import("@/lib/sequences/pageQueries");
  assert.deepEqual(await getSendingAccount(ownerId), { id: accountId, address: `zz-pages-sender-${run}@example.test` });
  assert.equal(await getSendingAccount(otherId), null);
});

test("the list reads only the signed-in BD's Sequences, newest first, with members and companies", async () => {
  const { listSequencesForBd } = await import("@/lib/sequences/pageQueries");
  const ck = await mkCompany("list");
  const p = await mkPerson("list1", ck);
  await mkMember(sequenceId, p.id, "approved", { draft: true });
  await mkMember(sequenceId, (await mkPerson("list2", ck)).id, "discarded");
  const rows = await listSequencesForBd(ownerId);
  assert.deepEqual(rows.map((r) => r.id), [sequenceId]);
  assert.equal(rows[0].members.length, 2);
  assert.deepEqual(rows[0].companies, [ck]);
  assert.ok(rows[0].createdAt instanceof Date);
  const approved = rows[0].members.find((m) => m.state === "approved");
  assert.equal(approved?.hasDraft, true);
  assert.equal(rows[0].dailySendCap, 5);
  assert.equal((await listSequencesForBd(otherId)).map((r) => r.id)[0], otherSequenceId);
});

test("the list does not truncate: 250 members are all there", async () => {
  const { db } = await import("@/db");
  const { person, sequence, sequenceMember } = await import("@/db/schema");
  const { listSequencesForBd } = await import("@/lib/sequences/pageQueries");
  const { listView } = await import("@/lib/sequences/listView");
  const [big] = await db.insert(sequence).values({ name: key("big"), ownerBdId: ownerId, emailAccountId: accountId, schedule: {} }).returning();
  sequenceIds.push(big.id);
  const people = await db
    .insert(person)
    .values(Array.from({ length: 250 }, (_, i) => ({ firstName: `big${i}`, lastName: run, email: `${key(`big${i}`)}@example.test`, emailNormalized: `${key(`big${i}`)}@example.test` })))
    .returning({ id: person.id });
  personIds.push(...people.map((p) => p.id));
  await db.insert(sequenceMember).values(people.map((p) => ({ sequenceId: big.id, personId: p.id, state: "drafted" })));
  const rows = await listSequencesForBd(ownerId);
  const row = rows.find((r) => r.id === big.id)!;
  assert.equal(row.members.length, 250);
  assert.equal(listView([row]).rows[0].total, 250);
});

test("a Sequence with no members still appears in the list", async () => {
  const { db } = await import("@/db");
  const { sequence } = await import("@/db/schema");
  const { listSequencesForBd } = await import("@/lib/sequences/pageQueries");
  const [empty] = await db.insert(sequence).values({ name: key("empty"), ownerBdId: otherId, emailAccountId: otherAccountId, schedule: {} }).returning();
  sequenceIds.push(empty.id);
  const row = (await listSequencesForBd(otherId)).find((r) => r.id === empty.id);
  assert.ok(row);
  assert.deepEqual(row.members, []);
});

test("the picker KEEPS contacts that cannot be added, each with its reason, and every row has a company key", async () => {
  const { db } = await import("@/db");
  const { emailSuppression } = await import("@/db/schema");
  const { listPickerContacts } = await import("@/lib/sequences/pageQueries");
  const ok = await mkPerson("pk-ok", await mkCompany("pk-ok"));
  const client = await mkPerson("pk-client", await mkCompany("pk-client", { clientStatus: "active" }));
  const former = await mkPerson("pk-former", await mkCompany("pk-former", { clientStatus: "inactive" }));
  const survivor = await mkPerson("pk-survivor", await mkCompany("pk-survivor"));
  const merged = await mkPerson("pk-merged", await mkCompany("pk-merged"), { mergedIntoId: survivor.id });
  const noEmail = await mkPerson("pk-noemail", await mkCompany("pk-noemail"), { email: null, emailStatus: "none" });
  const suppressed = await mkPerson("pk-supp", await mkCompany("pk-supp"));
  await db.insert(emailSuppression).values({ kind: "address", value: suppressed.email!.toLowerCase(), source: "manual", personId: suppressed.id });
  await mkPerson("pk-noposting", await mkCompany("pk-noposting", { postings: false }));
  await mkPerson("pk-nocompany", null);

  const pool = await listPickerContacts("Sin nombre");
  const by = new Map(pool.map((c) => [c.personId, c]));
  assert.equal(by.get(ok.id)?.block, null);
  assert.equal(by.get(client.id)?.block, "client");
  assert.equal(by.get(former.id)?.block, "clientFormer");
  assert.equal(by.get(merged.id)?.block, "merged");
  assert.equal(by.get(merged.id)?.survivorId, survivor.id);
  assert.equal(by.get(noEmail.id)?.block, "noEmail");
  assert.equal(by.get(suppressed.id)?.block, "suppressed");
  assert.equal(by.get(ok.id)?.openIt, 1);
  assert.equal(by.get(ok.id)?.florida, true);
  assert.equal(by.get(ok.id)?.status, "new");
  // Outside the pool by construction: no open IT posting, no company at all.
  assert.ok(![...by.values()].some((c) => c.name.startsWith("pk-noposting") || c.name.startsWith("pk-nocompany")));
  assert.ok(pool.every((c) => c.companyKey), "a company-less contact would count as its own company");
  // Addable contacts sort ahead of the merged and email-less ones, so a pool bound could only cut the unaddable.
  const order = pool.map((c) => c.personId);
  assert.ok(order.indexOf(ok.id) < order.indexOf(merged.id));
  assert.ok(order.indexOf(ok.id) < order.indexOf(noEmail.id));
});

// --- the company NAME a Contact shows: free text wins, the canonical name fills a null (companyDisplayName.ts) ----------

/** A company with an open US IT posting whose canonical display name differs from its key. */
async function mkNamedCompany(name: string, displayName: string | null) {
  const { db } = await import("@/db");
  const { company, jobPosting, targetCompany } = await import("@/db/schema");
  const ck = key(`named-${name}`);
  companyKeys.push(ck);
  if (displayName !== null) await db.insert(company).values({ companyKey: ck, displayName });
  await db.insert(targetCompany).values({ companyKey: ck, displayName: displayName ?? ck, ats: "lever", config: {} });
  await db.insert(jobPosting).values({ companyKey: ck, externalId: "1", title: "Engineer", location: "Miami, FL", url: "https://example.test", isIt: true, market: "us", isMiami: true });
  return ck;
}

test("the list shows the canonical company for a null free text, the free text when present, and nothing for a key with no company row", async () => {
  const { listSequencesForBd } = await import("@/lib/sequences/pageQueries");
  const { db } = await import("@/db");
  const { sequence } = await import("@/db/schema");
  const [seq] = await db.insert(sequence).values({ name: key("names"), ownerBdId: otherId, emailAccountId: otherAccountId, schedule: {} }).returning();
  sequenceIds.push(seq.id);
  await mkMember(seq.id, (await mkPerson("nm-free", await mkNamedCompany("l1", `Canon L1 ${run}`), { company: `Free L1 ${run}` })).id, "drafted");
  await mkMember(seq.id, (await mkPerson("nm-null", await mkNamedCompany("l2", `Canon L2 ${run}`), { company: null })).id, "drafted");
  await mkMember(seq.id, (await mkPerson("nm-dangling", await mkNamedCompany("l3", null), { company: null })).id, "drafted");
  const row = (await listSequencesForBd(otherId)).find((r) => r.id === seq.id)!;
  assert.deepEqual(row.companies, [`Free L1 ${run}`, `Canon L2 ${run}`]);
});

test("the picker shows the canonical company for a null free text and orders by the name it SHOWS", async () => {
  const { listPickerContacts } = await import("@/lib/sequences/pageQueries");
  const mid = await mkPerson("po-mid", await mkNamedCompany("p1", `Zzz canonical ${run}`), { company: `Mmm free ${run}` });
  const low = await mkPerson("po-low", await mkNamedCompany("p2", `Aaa canonical ${run}`), { company: null });
  const high = await mkPerson("po-high", await mkNamedCompany("p3", `Ttt canonical ${run}`), { company: null });
  const dangling = await mkPerson("po-dangling", await mkNamedCompany("p4", null), { company: null });
  const pool = await listPickerContacts("Sin nombre");
  const by = new Map(pool.map((c) => [c.personId, c]));
  assert.equal(by.get(mid.id)?.company, `Mmm free ${run}`);
  assert.equal(by.get(low.id)?.company, `Aaa canonical ${run}`);
  assert.equal(by.get(high.id)?.company, `Ttt canonical ${run}`);
  assert.equal(by.get(dangling.id)?.company, null);
  const order = pool.map((c) => c.personId);
  assert.ok(order.indexOf(low.id) < order.indexOf(mid.id) && order.indexOf(mid.id) < order.indexOf(high.id), "ordered Aaa, Mmm, Ttt by displayed name");
});

test("a Contact's memberships are found by EMAIL ADDRESS: a second Contact row with the same address is included", async () => {
  const { listContactMemberships } = await import("@/lib/sequences/pageQueries");
  const ck = await mkCompany("ctx");
  const shared = `${key("shared")}@example.test`;
  const first = await mkPerson("ctx-a", ck, { email: shared });
  const second = await mkPerson("ctx-b", ck, { email: shared.toUpperCase() });
  const stranger = await mkPerson("ctx-c", ck);
  const mine = await mkMember(sequenceId, first.id, "sent");
  const theirs = await mkMember(otherSequenceId, second.id, "drafted");
  await mkMember(otherSequenceId, stranger.id, "drafted");

  const rows = await listContactMemberships(ownerId, shared);
  assert.deepEqual(rows.map((r) => r.memberId).sort(), [mine.id, theirs.id].sort());
  assert.equal(rows.find((r) => r.memberId === mine.id)?.ownedByViewer, true);
  assert.equal(rows.find((r) => r.memberId === theirs.id)?.ownedByViewer, false);
  assert.equal(rows.find((r) => r.memberId === mine.id)?.sequenceName, key("seq"));
  assert.deepEqual(await listContactMemberships(ownerId, null), []);
  assert.deepEqual(await listContactMemberships(ownerId, "   "), []);
});

test("opted-out history is never the part a bound cuts, and discarded sort after live memberships", async () => {
  const { listContactMemberships } = await import("@/lib/sequences/pageQueries");
  const ck = await mkCompany("ord");
  const email = `${key("ord")}@example.test`;
  const discarded = await mkMember(sequenceId, (await mkPerson("ord-a", ck, { email })).id, "discarded", { discardReason: "manual" });
  const optOut = await mkMember(otherSequenceId, (await mkPerson("ord-b", ck, { email })).id, "discarded", { discardReason: "opt_out" });
  const live = await mkMember(sequenceId, (await mkPerson("ord-c", ck, { email })).id, "drafted");
  const ids = (await listContactMemberships(ownerId, email)).map((r) => r.memberId);
  assert.equal(ids[ids.length - 1], discarded.id);
  assert.deepEqual(new Set(ids.slice(0, 2)), new Set([live.id, optOut.id]));
});

test("opt-out phrases come only from the owner's own mailbox and genuine replies", async () => {
  const { db } = await import("@/db");
  const { emailMessage, emailMessagePerson } = await import("@/db/schema");
  const { listReplyPhrases } = await import("@/lib/sequences/pageQueries");
  const ck = await mkCompany("ph");
  const p = await mkPerson("ph", ck);
  const m = await mkMember(sequenceId, p.id, "replied");
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  await db.update(sequenceMember).set({ sentAt: new Date(Date.now() - 86_400_000) }).where(eq(sequenceMember.id, m.id));
  const mkMessage = async (bdId: string, id: string, body: string, over: { auto?: boolean; match?: string } = {}) => {
    const [msg] = await db.insert(emailMessage).values({ bdId, gmailMessageId: `${key(id)}`, gmailThreadId: key(`t-${id}`), direction: "inbound", personId: p.id, fromAddress: p.email!, subject: "Re", bodyText: body, sentAt: new Date(), matchedEmail: p.email!, matchConfidence: "exact", isAutomatic: over.auto ?? false }).returning();
    await db.insert(emailMessagePerson).values({ emailMessageId: msg.id, personId: p.id, matchedEmail: p.email!, matchConfidence: over.match ?? "exact" });
  };
  await mkMessage(otherId, "other-box", "please unsubscribe me");
  assert.deepEqual(await listReplyPhrases(ownerId, [m.id]), {}, "another BD's mailbox is not read");
  await mkMessage(ownerId, "auto", "unsubscribe", { auto: true });
  await mkMessage(ownerId, "thread", "unsubscribe", { match: "thread" });
  assert.deepEqual(await listReplyPhrases(ownerId, [m.id]), {}, "automatic and thread-attributed mail never raise it");
  await mkMessage(ownerId, "real", "Not interested, please remove me from your list");
  assert.deepEqual(await listReplyPhrases(ownerId, [m.id]), { [m.id]: "remove me" });
  assert.deepEqual(await listReplyPhrases(ownerId, []), {});
});

test("sequence_count: this BD's Sequences with at least one member still in progress, in the same statement as the other badges", async () => {
  const { db } = await import("@/db");
  const { sequence } = await import("@/db/schema");
  const { buildAppShellBadgeCountsQuery } = await import("@/lib/shell/appShellBadgeCountsQuery");
  const count = async (bdId: string) => {
    const [r] = (await db.execute(buildAppShellBadgeCountsQuery({ bdId, queueDate: "2026-10-15", tomorrowStartUtcIso: "2026-10-16T00:00:00Z", workedTodayFromIso: "2026-10-15T03:00:00Z", workedTodayToIso: "2026-10-16T03:00:00Z" }))) as unknown as { sequence_count: number }[];
    return r.sequence_count;
  };
  const ck = await mkCompany("badge");
  const [fresh] = await db.insert(sequence).values({ name: key("badge-live"), ownerBdId: otherId, emailAccountId: otherAccountId, schedule: {} }).returning();
  const [done] = await db.insert(sequence).values({ name: key("badge-done"), ownerBdId: otherId, emailAccountId: otherAccountId, schedule: {} }).returning();
  sequenceIds.push(fresh.id, done.id);
  const before = await count(otherId);
  const ownerBefore = await count(ownerId);
  // Only closed members: does not count. An empty Sequence has no member in progress: does not count.
  await mkMember(done.id, (await mkPerson("badge-a", ck)).id, "replied");
  await mkMember(done.id, (await mkPerson("badge-b", ck)).id, "no_reply");
  await mkMember(done.id, (await mkPerson("badge-c", ck)).id, "discarded");
  assert.equal(await count(otherId), before);
  // One drafted member makes the Sequence count, and one Sequence counts once however many members it has.
  await mkMember(fresh.id, (await mkPerson("badge-d", ck)).id, "drafted");
  await mkMember(fresh.id, (await mkPerson("badge-e", ck)).id, "sent");
  assert.equal(await count(otherId), before + 1);
  // Per-BD: the other BD's count did not move.
  assert.equal(await count(ownerId), ownerBefore);
});

test("review signals come from the generator input, for the owner only", async () => {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { memberDraftSignals } = await import("@/lib/sequences/draftQueries");
  const ck = await mkCompany("sig");
  const p = await mkPerson("sig", ck);
  await db.update(person).set({ country: "United States" }).where(eq(person.id, p.id));
  const m = await mkMember(sequenceId, p.id, "drafted", { draft: true });
  const signals = await memberDraftSignals(ownerId, m.id);
  assert.ok(signals);
  assert.deepEqual(signals.find((s) => s.kind === "hiring"), { kind: "hiring", count: 1 });
  assert.equal(await memberDraftSignals(otherId, m.id), null, "another BD gets nothing");
  assert.equal(await memberDraftSignals(ownerId, randomUUID()), null);
});

test("saving the REMINDER edits step 2 only, withdraws its approval, and never moves the member", async () => {
  const { db } = await import("@/db");
  const { person, sequenceDraft, sequenceMember } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { saveDraftEdit } = await import("@/lib/sequences/draftQueries");
  const ck = await mkCompany("rem");
  const p = await mkPerson("rem", ck);
  await db.update(person).set({ country: "United States" }).where(eq(person.id, p.id));
  const m = await mkMember(sequenceId, p.id, "sent", { draft: true });
  await db.insert(sequenceDraft).values({ sequenceMemberId: m.id, step: 2, subject: "Reminder subject", body: "Reminder body", reviewedAt: new Date(), approvedAt: new Date(), scheduledFor: new Date() });
  const step = (n: number) => db.select().from(sequenceDraft).where(and(eq(sequenceDraft.sequenceMemberId, m.id), eq(sequenceDraft.step, n))).then((r) => r[0]);

  const saved = await saveDraftEdit(ownerId, m.id, { subject: "New subject", body: "New body" }, 2);
  assert.equal(saved.ok, true);
  const reminder = await step(2);
  assert.equal(reminder.subject, "New subject");
  assert.equal(reminder.approvedAt, null);
  assert.equal(reminder.reviewedAt, null);
  assert.equal(reminder.scheduledFor, null);
  assert.equal((await step(1)).subject, "S", "step 1 is untouched");
  const [member] = await db.select().from(sequenceMember).where(eq(sequenceMember.id, m.id));
  assert.equal(member.state, "sent");

  // Step 1 of a sent member is not editable, and a reminder cannot be saved for a member that never got one.
  assert.deepEqual(await saveDraftEdit(ownerId, m.id, { subject: "x", body: "y" }, 1), { ok: false, error: "not_editable" });
  const drafted = await mkMember(sequenceId, (await mkPerson("rem2", ck)).id, "drafted", { draft: true });
  assert.deepEqual(await saveDraftEdit(ownerId, drafted.id, { subject: "x", body: "y" }, 2), { ok: false, error: "not_found" });
  assert.deepEqual(await saveDraftEdit(otherId, m.id, { subject: "x", body: "y" }, 2), { ok: false, error: "not_found" });
});
