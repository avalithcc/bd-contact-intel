/**
 * DB-backed tests for the person-merge policy for Sequence memberships. Only a real Postgres proves that a merge never
 * destroys a sequence_send_claim (it cascades from sequence_member and is the only guard against a second send).
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

async function mkMember(sequenceId: string, personId: string, state: string) {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const [m] = await db.insert(sequenceMember).values({ sequenceId, personId, state }).returning();
  return m.id;
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

// ---- person merge policy ----

async function twoPeople(tag: string) {
  const c = await mkCompany(`mg-${tag}`, null);
  return { s: await mkPerson(`${tag}s`, c), m: await mkPerson(`${tag}m`, c) };
}

test("merge: an approved member (scheduled send) blocks even when acknowledged, names the send, and can be cancelled from the warning", async () => {
  const { mergeContacts } = await import("@/lib/identity/mergeDb");
  const { SequenceMergeBlockedError, cancelScheduledSend } = await import("@/lib/sequences/mergeQueries");
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { s, m } = await twoPeople("ap");
  const seq = await mkSequence();
  const member = await mkMember(seq, m, "approved");

  await assert.rejects(mergeContacts(db, s, m, "test", bdId, { acknowledgeSequences: true }), (e: unknown) => {
    assert.ok(e instanceof SequenceMergeBlockedError);
    assert.deepEqual(e.plan.blockers, ["scheduled_send"]);
    assert.equal(e.plan.affected[0].scheduledSend, true);
    assert.equal(e.plan.affected[0].memberId, member);
    return true;
  });
  assert.equal((await db.select().from(person).where(eq(person.id, m)))[0].mergedIntoId, null, "the merge rolled back");

  assert.equal(await cancelScheduledSend(db, member), true);
  assert.equal((await memberRow(member)).state, "drafted");
  await assert.rejects(mergeContacts(db, s, m, "test", bdId), SequenceMergeBlockedError, "still needs acknowledgement");
  await mergeContacts(db, s, m, "test", bdId, { acknowledgeSequences: true });
  assert.equal((await memberRow(member)).personId, s);
});

test("merge: a sent member is repointed and its send claim survives", async () => {
  const { mergeContacts } = await import("@/lib/identity/mergeDb");
  const { db } = await import("@/db");
  const { sequenceSendClaim } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { s, m } = await twoPeople("sn");
  const seq = await mkSequence();
  const member = await mkMember(seq, m, "sent");
  await db.insert(sequenceSendClaim).values({ sequenceMemberId: member, step: 1, outcome: "sent", sendingAccountId: accountId });

  await mergeContacts(db, s, m, "test", bdId, { acknowledgeSequences: true });
  const row = await memberRow(member);
  assert.equal(row.personId, s);
  assert.equal(row.state, "sent");
  assert.equal((await db.select().from(sequenceSendClaim).where(eq(sequenceSendClaim.sequenceMemberId, member))).length, 1);
});

test("merge: a same-sequence collision involving a sent member is refused and nothing is deleted", async () => {
  const { mergeContacts } = await import("@/lib/identity/mergeDb");
  const { SequenceMergeBlockedError } = await import("@/lib/sequences/mergeQueries");
  const { db } = await import("@/db");
  const { sequenceSendClaim } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { s, m } = await twoPeople("co");
  const seq = await mkSequence();
  const sMember = await mkMember(seq, s, "drafted");
  const mMember = await mkMember(seq, m, "sent");
  await db.insert(sequenceSendClaim).values({ sequenceMemberId: mMember, step: 1, outcome: "sent", sendingAccountId: accountId });

  await assert.rejects(mergeContacts(db, s, m, "test", bdId, { acknowledgeSequences: true }), (e: unknown) => {
    assert.ok(e instanceof SequenceMergeBlockedError);
    assert.deepEqual(e.plan.blockers, ["send_history_collision"]);
    return true;
  });
  assert.equal((await memberRow(sMember)).state, "drafted");
  assert.equal((await memberRow(mMember)).state, "sent");
  assert.equal((await db.select().from(sequenceSendClaim).where(eq(sequenceSendClaim.sequenceMemberId, mMember))).length, 1);
});

test("merge: same-sequence drafted/drafted keeps the survivor's membership and discards the other with a reason", async () => {
  const { mergeContacts } = await import("@/lib/identity/mergeDb");
  const { db } = await import("@/db");
  const { s, m } = await twoPeople("dd");
  const seq = await mkSequence();
  const sMember = await mkMember(seq, s, "drafted");
  const mMember = await mkMember(seq, m, "drafted");
  await mergeContacts(db, s, m, "test", bdId, { acknowledgeSequences: true });
  assert.equal((await memberRow(sMember)).state, "drafted");
  const loser = await memberRow(mMember);
  assert.equal(loser.state, "discarded");
  assert.equal(loser.discardReason, "merge_duplicate");
  assert.equal(loser.discardedByBdId, bdId);
});

test("merge: a person in no Sequence merges with no acknowledgement (no-op)", async () => {
  const { mergeContacts } = await import("@/lib/identity/mergeDb");
  const { db } = await import("@/db");
  const { s, m } = await twoPeople("no");
  await mergeContacts(db, s, m, "test", bdId);
});

// Registered last: node:test runs after-hooks in registration order and cleanup above still needs the pool.
after(async () => {
  const { db } = await import("@/db");
  await db.$client.end();
});
