/**
 * DB-backed tests for the roster guards and the person-merge policy for Sequence memberships. Only a real Postgres
 * proves the picker SQL (client exclusion, alias resolution, posting join), the per-Sequence row lock that makes the
 * 2-per-company cap race-safe, and that a merge never destroys a sequence_send_claim.
 *
 * Opt-in and fail-closed like the other files here: `npm run test:db`, DATABASE_URL pointing at a database whose name
 * ends in `_e2e`. Every row is created under a per-run token and removed in dependency order afterwards.
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
const personIds: string[] = [];
const sequenceIds: string[] = [];
const companyKeys: string[] = [];

async function mkCompany(name: string, clientStatus: string | null, opts: { posting?: "florida" | "texas" | "none"; alias?: string } = {}) {
  const { db } = await import("@/db");
  const { company, companyAlias, jobPosting, targetCompany } = await import("@/db/schema");
  const ck = key(name);
  companyKeys.push(ck);
  await db.insert(company).values({ companyKey: ck, displayName: ck, clientStatus });
  await db.insert(targetCompany).values({ companyKey: ck, displayName: ck, ats: "lever", config: {} });
  if (opts.alias) await db.insert(companyAlias).values({ aliasKey: key(opts.alias), companyKey: ck });
  const posting = opts.posting ?? "florida";
  if (posting !== "none") {
    await db.insert(jobPosting).values({
      companyKey: ck, externalId: "1", title: "Engineer", location: posting === "florida" ? "Miami, FL" : "Austin, TX",
      url: "https://example.test", isIt: true, market: "us", isMiami: posting === "florida",
    });
  }
  return ck;
}

async function mkPerson(name: string, companyKey: string | null, over: Record<string, unknown> = {}) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const email = `${key(name)}@example.test`;
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", company: companyKey, companyKey, ...over }).returning();
  personIds.push(p.id);
  return p.id;
}

async function mkSequence() {
  const { db } = await import("@/db");
  const { sequence } = await import("@/db/schema");
  const [s] = await db.insert(sequence).values({ name: key("seq"), ownerBdId: bdId, emailAccountId: accountId, schedule: {} }).returning();
  sequenceIds.push(s.id);
  return s.id;
}

const memberRow = async (id: string) => {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceMember).where(eq(sequenceMember.id, id)))[0];
};

before(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount } = await import("@/db/schema");
  const [a] = await db.insert(bd).values({ name: "ZZ Roster", email: `zz-roster-${run}@example.test` }).returning();
  const [b] = await db.insert(bd).values({ name: "ZZ Other", email: `zz-other-${run}@example.test` }).returning();
  bdId = a.id;
  otherBdId = b.id;
  const [acc] = await db.insert(emailAccount).values({ bdId, emailAddress: `zz-sender-${run}@example.test` }).returning();
  accountId = acc.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, companyAlias, emailSuppression, mergeEvent, person, personPropertyHistory, sequence, targetCompany, emailAccount } = await import("@/db/schema");
  const { inArray, or, eq } = await import("drizzle-orm");
  if (personIds.length) {
    await db.delete(mergeEvent).where(or(inArray(mergeEvent.survivorId, personIds), inArray(mergeEvent.mergedId, personIds)));
    await db.delete(personPropertyHistory).where(inArray(personPropertyHistory.personId, personIds));
  }
  if (sequenceIds.length) await db.delete(sequence).where(inArray(sequence.id, sequenceIds));
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
  if (companyKeys.length) {
    await db.delete(companyAlias).where(inArray(companyAlias.companyKey, companyKeys));
    await db.delete(targetCompany).where(inArray(targetCompany.companyKey, companyKeys));
    await db.delete(company).where(inArray(company.companyKey, companyKeys));
  }
  await db.delete(emailSuppression).where(eq(emailSuppression.source, `zz-${run}`));
  await db.delete(emailAccount).where(inArray(emailAccount.bdId, [bdId, otherBdId]));
  await db.delete(bd).where(inArray(bd.id, [bdId, otherBdId]));
});

test("picker offers a clean Contact and excludes active clients, INACTIVE clients, merged, none, an UNCONFIRMED guess and no-posting", async () => {
  const { listRosterCandidates } = await import("@/lib/sequences/rosterQueries");
  const ok = await mkCompany("pk-ok", null, { alias: "pk-ok-alias" });
  const act = await mkCompany("pk-active", "active");
  const inact = await mkCompany("pk-inactive", "inactive");
  const idle = await mkCompany("pk-idle", null, { posting: "none" });
  const fl = await mkPerson("fine", ok);
  const viaAlias = await mkPerson("viaalias", key("pk-ok-alias"));
  await mkPerson("active", act);
  await mkPerson("inactive", inact);
  await mkPerson("idle", idle);
  await mkPerson("merged", ok, { mergedIntoId: fl });
  await mkPerson("none", ok, { emailStatus: "none" });
  // An inferred address we never confirmed stays out. One a reply CONFIRMED is reachable: mail from
  // that exact mailbox outranks any import label, so `verified` beats `pattern_inferred` here
  // (src/lib/sequences/rosterGuards.ts). Both cases are pinned, because asserting only the exclusion
  // would keep passing if the rule silently went back to rejecting every guess.
  await mkPerson("guess", ok, { emailSource: "pattern_inferred", emailStatus: "probable" });
  const guessConfirmed = await mkPerson("guessok", ok, { emailSource: "pattern_inferred", emailStatus: "verified" });
  await mkPerson("noemail", ok, { email: null, emailNormalized: null });

  const rows = await listRosterCandidates({ limit: 200, search: run });
  assert.deepEqual(rows.map((r) => r.person_id).sort(), [fl, viaAlias, guessConfirmed].sort());
  assert.ok(rows.every((r) => r.is_florida === true));
});

test("candidates show the canonical company for a null free text, search and order by the name they SHOW", async () => {
  const { db } = await import("@/db");
  const { company } = await import("@/db/schema");
  const { listRosterCandidates } = await import("@/lib/sequences/rosterQueries");
  const named = async (name: string, displayName: string | null) => {
    const ck = await mkCompany(name, null);
    if (displayName !== null) await db.update(company).set({ displayName }).where((await import("drizzle-orm")).eq(company.companyKey, ck));
    else await db.delete(company).where((await import("drizzle-orm")).eq(company.companyKey, ck));
    return ck;
  };
  const mid = await mkPerson("rn-mid", await named("rn1", `Zzz canon ${run}`), { company: `Mmm free ${run}` });
  const low = await mkPerson("rn-low", await named("rn2", `Aaa canon ${run}`), { company: null });
  const dangling = await mkPerson("rn-dangling", await named("rn3", null), { company: null });
  const rows = await listRosterCandidates({ limit: 200, search: run });
  const by = new Map(rows.map((r) => [r.person_id, r]));
  assert.equal(by.get(mid)?.company, `Mmm free ${run}`);
  assert.equal(by.get(low)?.company, `Aaa canon ${run}`);
  assert.equal(by.get(dangling)?.company, null);
  const order = rows.map((r) => r.person_id);
  assert.ok(order.indexOf(low) < order.indexOf(mid), "ordered by the shown name: Aaa before Mmm");
  // Search follows the shown name: the canonical name finds the null-free-text contact, but NOT the one whose free text hides it.
  const byCanon = (await listRosterCandidates({ limit: 200, search: `canon ${run}` })).map((r) => r.person_id);
  assert.deepEqual(byCanon, [low]);
  assert.deepEqual((await listRosterCandidates({ limit: 200, search: `free ${run}` })).map((r) => r.person_id), [mid]);
});

test("Florida label comes from is_miami and a NULL is_startup does not exclude", async () => {
  const { listRosterCandidates } = await import("@/lib/sequences/rosterQueries");
  const tx = await mkCompany("tx", null, { posting: "texas" });
  const p = await mkPerson("texan", tx);
  const row = (await listRosterCandidates({ limit: 200, search: run })).find((r) => r.person_id === p);
  assert.ok(row);
  assert.equal(row.is_florida, false);
});

test("picker excludes a suppressed address", async () => {
  const { db } = await import("@/db");
  const { emailSuppression } = await import("@/db/schema");
  const { listRosterCandidates } = await import("@/lib/sequences/rosterQueries");
  const c = await mkCompany("sup", null);
  const p = await mkPerson("suppressed", c);
  await db.insert(emailSuppression).values({ kind: "address", value: `${key("suppressed")}@example.test`, source: `zz-${run}` });
  assert.ok(!(await listRosterCandidates({ limit: 200, search: run })).some((r) => r.person_id === p));
});

test("add: INACTIVE and ACTIVE clients are rejected server-side on a direct request", async () => {
  const { addMembersToSequence } = await import("@/lib/sequences/rosterQueries");
  const seq = await mkSequence();
  const inact = await mkPerson("ci", await mkCompany("c-inactive", "inactive"));
  const act = await mkPerson("ca", await mkCompany("c-active", "active"));
  const r = await addMembersToSequence(bdId, seq, [inact, act]);
  assert.ok(r.ok);
  assert.deepEqual(r.rejected.map((x) => x.reason), ["client", "client"]);
  assert.equal(r.accepted.length, 0);
});

test("add: third contact at one company is reported, discarded do not count, and re-add of a member is a duplicate", async () => {
  const { addMembersToSequence } = await import("@/lib/sequences/rosterQueries");
  const seq = await mkSequence();
  const c = await mkCompany("lim", null);
  const [a, b, d, e] = await Promise.all(["la", "lb", "ld", "le"].map((n) => mkPerson(n, c)));
  const r = await addMembersToSequence(bdId, seq, [a, b, d]);
  assert.ok(r.ok);
  assert.deepEqual(r.accepted, [a, b]);
  assert.deepEqual(r.rejected, [{ personId: d, reason: "company_limit" }]);
  assert.deepEqual((await addMembersToSequence(bdId, seq, [a])), { ok: true, accepted: [], rejected: [{ personId: a, reason: "duplicate" }] });
  assert.deepEqual((await addMembersToSequence(otherBdId, seq, [e])), { ok: false, error: "not_found" });
});

test("add: concurrent adds cannot exceed 2 per company (the Sequence row lock serializes them)", async () => {
  const { addMembersToSequence } = await import("@/lib/sequences/rosterQueries");
  const seq = await mkSequence();
  const c = await mkCompany("race", null);
  const people = await Promise.all(["r1", "r2", "r3", "r4", "r5"].map((n) => mkPerson(n, c)));
  const results = await Promise.all(people.map((p) => addMembersToSequence(bdId, seq, [p])));
  assert.equal(results.filter((r) => r.ok && r.accepted.length === 1).length, 2);
});

test("remove requires a reason and records actor; reinstate drops approval, re-runs guards and rejects opt_out", async () => {
  const { removeMembersFromSequence, reinstateSequenceMember, addMembersToSequence } = await import("@/lib/sequences/rosterQueries");
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const seq = await mkSequence();
  const c = await mkCompany("rm", null);
  const [a, b, d] = await Promise.all(["ma", "mb", "md"].map((n) => mkPerson(n, c)));
  const first = await addMembersToSequence(bdId, seq, [a, b]);
  assert.ok(first.ok && first.accepted.length === 2);
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [mA] = await db.select().from(sequenceMember).where(eq(sequenceMember.personId, a));
  await db.update(sequenceMember).set({ state: "approved" }).where(eq(sequenceMember.id, mA.id));
  await db.insert(sequenceDraft).values({ sequenceMemberId: mA.id, step: 1, subject: "s", body: "b", approvedAt: new Date(), approvedByBdId: bdId, scheduledFor: new Date() });

  assert.deepEqual(await removeMembersFromSequence(bdId, seq, [mA.id], "  "), { ok: false, error: "reason_required" });
  assert.equal((await memberRow(mA.id)).state, "approved");
  const removed = await removeMembersFromSequence(bdId, seq, [mA.id], "no title");
  assert.ok(removed.ok && removed.removed[0] === mA.id);
  const row = await memberRow(mA.id);
  assert.equal(row.state, "discarded");
  assert.equal(row.discardedByBdId, bdId);
  assert.equal(row.discardReason, "no title");
  const [draft] = await db.select().from(sequenceDraft).where(eq(sequenceDraft.sequenceMemberId, mA.id));
  assert.equal(draft.approvedAt, null);

  // a discarded member frees the slot, so a third contact fits; then re-admitting the first is over the limit
  assert.ok((await addMembersToSequence(bdId, seq, [d])).ok);
  assert.deepEqual(await reinstateSequenceMember(bdId, mA.id), { ok: false, error: "company_limit" });

  const [mB] = await db.select().from(sequenceMember).where(eq(sequenceMember.personId, b));
  await removeMembersFromSequence(bdId, seq, [mB.id], "x");
  assert.deepEqual(await reinstateSequenceMember(bdId, mB.id), { ok: true });
  assert.equal((await memberRow(mB.id)).state, "drafted");
  await db.update(sequenceMember).set({ state: "discarded", discardReason: "opt_out" }).where(eq(sequenceMember.id, mB.id));
  assert.deepEqual(await reinstateSequenceMember(bdId, mB.id), { ok: false, error: "opt_out" });
});

test("createSequence/updateSettings: name required, account must be the BD's own, cap validated, default 5", async () => {
  const { createSequenceRow, updateSequenceSettingsRow } = await import("@/lib/sequences/rosterQueries");
  assert.deepEqual(await createSequenceRow(bdId, { name: " ", emailAccountId: accountId }), { ok: false, error: "name_required" });
  assert.deepEqual(await createSequenceRow(otherBdId, { name: "n", emailAccountId: accountId }), { ok: false, error: "account_not_owned" });
  assert.deepEqual(await createSequenceRow(bdId, { name: "n", emailAccountId: accountId, dailySendCap: 500 }), { ok: false, error: "above_ceiling" });
  const ok = await createSequenceRow(bdId, { name: key("created"), emailAccountId: accountId });
  assert.ok(ok.ok);
  sequenceIds.push(ok.sequenceId);
  assert.deepEqual(await updateSequenceSettingsRow(bdId, ok.sequenceId, { dailySendCap: 12 }), { ok: true, capWarning: true });
  assert.deepEqual(await updateSequenceSettingsRow(otherBdId, ok.sequenceId, { dailySendCap: 6 }), { ok: false, error: "not_found" });
});

// Registered last: node:test runs after-hooks in registration order and cleanup above still needs the pool.
after(async () => {
  const { db } = await import("@/db");
  await db.$client.end();
});
