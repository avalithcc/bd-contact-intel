/**
 * DB-backed test for the unsubscribe write path (`suppressByToken`). The unit suite proves the handlers over fake
 * ports; only a real Postgres proves that `unique(kind, value)` + `ON CONFLICT DO NOTHING` holds under real
 * concurrency, so two simultaneous POSTs for one token cannot produce two suppression rows or a rejected promise.
 *
 * Opt-in and fail-closed like the other files here: `npm run test:db`, DATABASE_URL pointing at a local database
 * whose name ends in `_e2e`. Concurrency needs separate connections, so this seeds COMMITTED rows (a rolled-back
 * transaction would be invisible to the other connections) under unique values per run and removes them in
 * dependency order afterwards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

// Closing the pool lets the process exit promptly (see companyDomainEdit.test.ts for the measurement).
after(async () => {
  const { db } = await import("@/db");
  await db.$client.end();
});

interface Fixture {
  bdId: string;
  accountId: string;
  sequenceId: string;
  personId: string;
  memberId: string;
  email: string;
  token: string;
  tokenHash: string;
}

async function seed(state = "approved"): Promise<Fixture> {
  const { db } = await import("@/db");
  const { bd, emailAccount, person, sequence, sequenceMember, sequenceUnsubscribeToken } = await import("@/db/schema");
  const { generateUnsubscribeToken, hashUnsubscribeToken } = await import("@/lib/sequences/unsubscribeToken");
  const run = randomUUID();
  const email = `zz-unsub-${run}@example.test`;
  const [owner] = await db.insert(bd).values({ name: "ZZ Unsub", email: `zz-owner-${run}@example.test` }).returning();
  const [account] = await db
    .insert(emailAccount)
    .values({ bdId: owner.id, emailAddress: `zz-sender-${run}@example.test` })
    .returning();
  const [seq] = await db
    .insert(sequence)
    .values({ name: `zz-unsub-${run}`, ownerBdId: owner.id, emailAccountId: account.id, schedule: {} })
    .returning();
  const [p] = await db.insert(person).values({ email, emailNormalized: email }).returning();
  const [member] = await db.insert(sequenceMember).values({ sequenceId: seq.id, personId: p.id, state }).returning();
  const token = generateUnsubscribeToken();
  const tokenHash = hashUnsubscribeToken(token);
  await db.insert(sequenceUnsubscribeToken).values({ tokenHash, sequenceMemberId: member.id, emailNormalized: email });
  return {
    bdId: owner.id,
    accountId: account.id,
    sequenceId: seq.id,
    personId: p.id,
    memberId: member.id,
    email,
    token,
    tokenHash,
  };
}

async function cleanup(f: Fixture): Promise<void> {
  const { db } = await import("@/db");
  const { bd, emailAccount, emailSuppression, person, sequence, sequenceMember, sequenceUnsubscribeToken } =
    await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  await db.delete(emailSuppression).where(eq(emailSuppression.value, f.email));
  await db.delete(sequenceUnsubscribeToken).where(eq(sequenceUnsubscribeToken.sequenceMemberId, f.memberId));
  await db.delete(sequenceMember).where(eq(sequenceMember.id, f.memberId));
  await db.delete(sequence).where(eq(sequence.id, f.sequenceId));
  await db.delete(person).where(eq(person.id, f.personId));
  await db.delete(emailAccount).where(eq(emailAccount.bdId, f.bdId));
  await db.delete(bd).where(eq(bd.id, f.bdId));
}

async function withFixture(state: string, body: (f: Fixture) => Promise<void>): Promise<void> {
  const f = await seed(state);
  try {
    await body(f);
  } finally {
    await cleanup(f);
  }
}

async function suppressionRows(email: string) {
  const { db } = await import("@/db");
  const { emailSuppression } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(emailSuppression).where(eq(emailSuppression.value, email));
}

async function memberRow(id: string) {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db.select().from(sequenceMember).where(eq(sequenceMember.id, id));
  return row;
}

test("12 concurrent POSTs for one token: one suppression row, every call resolves, member discarded once", async () => {
  await withFixture("approved", async (f) => {
    const { suppressByToken } = await import("@/lib/sequences/unsubscribeQueries");
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => suppressByToken(f.tokenHash)));

    assert.equal(results.filter((r) => r.status === "rejected").length, 0);
    for (const r of results) assert.deepEqual((r as PromiseFulfilledResult<unknown>).value, { email: f.email });

    const rows = await suppressionRows(f.email);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "address");
    assert.equal(rows[0].source, "unsubscribe_link");
    assert.equal(rows[0].recordedByBdId, null);
    assert.equal(rows[0].personId, f.personId);

    const member = await memberRow(f.memberId);
    assert.equal(member.state, "discarded");
    assert.equal(member.discardReason, "opt_out");
    assert.equal(member.discardedByBdId, null);
    assert.ok(member.discardedAt);
  });
});

test("an already-used token stays idempotent: a later call resolves and changes nothing", async () => {
  await withFixture("sent", async (f) => {
    const { suppressByToken } = await import("@/lib/sequences/unsubscribeQueries");
    const { db } = await import("@/db");
    const { sequenceUnsubscribeToken } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    await suppressByToken(f.tokenHash);
    const memberBefore = await memberRow(f.memberId);
    const [tokenBefore] = await db
      .select()
      .from(sequenceUnsubscribeToken)
      .where(eq(sequenceUnsubscribeToken.tokenHash, f.tokenHash));
    assert.ok(tokenBefore.usedAt);

    assert.deepEqual(await suppressByToken(f.tokenHash), { email: f.email });

    assert.equal((await suppressionRows(f.email)).length, 1);
    const memberAfter = await memberRow(f.memberId);
    assert.equal(memberAfter.state, "discarded");
    assert.equal(memberAfter.discardedAt?.getTime(), memberBefore.discardedAt?.getTime());
    const [tokenAfter] = await db
      .select()
      .from(sequenceUnsubscribeToken)
      .where(eq(sequenceUnsubscribeToken.tokenHash, f.tokenHash));
    assert.equal(tokenAfter.usedAt?.getTime(), tokenBefore.usedAt?.getTime());
  });
});

test("an unknown token hash writes nothing and resolves null; a GET lookup writes nothing either", async () => {
  await withFixture("approved", async (f) => {
    const { suppressByToken, findTokenByHash } = await import("@/lib/sequences/unsubscribeQueries");
    const { generateUnsubscribeToken, hashUnsubscribeToken } = await import("@/lib/sequences/unsubscribeToken");
    const unknownHash = hashUnsubscribeToken(generateUnsubscribeToken());

    assert.equal(await suppressByToken(unknownHash), null);
    assert.equal(await suppressByToken("not-a-hash"), null);
    assert.deepEqual(await findTokenByHash(f.tokenHash), { email: f.email });

    assert.equal((await suppressionRows(f.email)).length, 0);
    assert.equal((await memberRow(f.memberId)).state, "approved");
  });
});

test("a second token for the same member (the reminder's own) suppresses the same address once", async () => {
  await withFixture("sent", async (f) => {
    const { issueUnsubscribeToken, suppressByToken } = await import("@/lib/sequences/unsubscribeQueries");
    const { hashUnsubscribeToken } = await import("@/lib/sequences/unsubscribeToken");
    const second = await issueUnsubscribeToken({ sequenceMemberId: f.memberId, email: f.email.toUpperCase() });
    assert.notEqual(second, f.token);

    await Promise.all([suppressByToken(f.tokenHash), suppressByToken(hashUnsubscribeToken(second))]);

    assert.equal((await suppressionRows(f.email)).length, 1);
    assert.equal((await memberRow(f.memberId)).state, "discarded");
  });
});
