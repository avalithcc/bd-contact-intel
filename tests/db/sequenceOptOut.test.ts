/**
 * DB-backed tests for "No contactar" (task 10.8): the BD-triggered opt-out suppresses the address and discards every
 * live membership of it with reason opt_out, in one transaction with its audit rows. It shares its core with the
 * unsubscribe link (suppressAddressInTx), so the link's own tests (sequenceUnsubscribe) cover the shared half.
 * Opt-in and fail-closed: `npm run test:db`, DATABASE_URL naming a `*_e2e` database on loopback.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const bdIds: string[] = [];
const accountIds: string[] = [];
const personIds: string[] = [];
const suppressedValues: string[] = [];
let n = 0;

async function mkOwner() {
  const { db } = await import("@/db");
  const { bd, emailAccount } = await import("@/db/schema");
  const i = ++n;
  const [b] = await db.insert(bd).values({ name: `ZZ OptOut ${run} ${i}`, email: `zz-oo-${run}-${i}@example.test` }).returning();
  bdIds.push(b.id);
  const [acc] = await db.insert(emailAccount).values({ bdId: b.id, emailAddress: `zz-oo-sender-${run}-${i}@example.test` }).returning();
  accountIds.push(acc.id);
  return { bdId: b.id, accountId: acc.id };
}
async function mkSequence(o: { bdId: string; accountId: string }) {
  const { db } = await import("@/db");
  const { sequence } = await import("@/db/schema");
  const [s] = await db.insert(sequence).values({ name: `zz-oo-${run}-${++n}`, ownerBdId: o.bdId, emailAccountId: o.accountId, schedule: {} }).returning();
  return s.id;
}
async function mkPerson(name: string, withEmail = true) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const email = `Zz-OO-${name}-${run}@Example.test`;
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, ...(withEmail ? { email, emailNormalized: email.toLowerCase() } : {}) }).returning();
  personIds.push(p.id);
  suppressedValues.push(email.toLowerCase());
  return { id: p.id, normalized: email.toLowerCase() };
}
async function mkMember(sequenceId: string, personId: string, state: string) {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const [m] = await db.insert(sequenceMember).values({ sequenceId, personId, state, sentAt: state === "drafted" ? null : new Date("2026-10-08T13:00:00Z") }).returning();
  return m.id;
}
async function rows(memberIds: string[]) {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  return db.select().from(sequenceMember).where(inArray(sequenceMember.id, memberIds));
}
async function suppressionFor(value: string) {
  const { db } = await import("@/db");
  const { emailSuppression } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(emailSuppression).where(eq(emailSuppression.value, value));
}
async function audits(memberIds: string[]) {
  const { db } = await import("@/db");
  const { auditLog } = await import("@/db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const all = await db.select().from(auditLog).where(and(eq(auditLog.action, "sequence_member_opt_out")));
  return all.filter((a) => memberIds.includes((a.metadata as { memberId: string }).memberId));
}

before(async () => {
  await import("@/db");
});
after(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, emailSuppression, person, sequence } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (bdIds.length) await db.delete(sequence).where(inArray(sequence.ownerBdId, bdIds));
  if (suppressedValues.length) await db.delete(emailSuppression).where(inArray(emailSuppression.value, suppressedValues));
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
  if (accountIds.length) await db.delete(emailAccount).where(inArray(emailAccount.id, accountIds));
  if (bdIds.length) await db.delete(bd).where(inArray(bd.id, bdIds));
});

test("No contactar suppresses the address and discards EVERY live membership of it (a replied one included), audited, actor recorded", async () => {
  const { recordOptOutForMember } = await import("@/lib/sequences/optOutQueries");
  const owner = await mkOwner();
  const [s1, s2] = [await mkSequence(owner), await mkSequence(owner)];
  const p = await mkPerson("both");
  const replied = await mkMember(s1, p.id, "replied");
  const drafted = await mkMember(s2, p.id, "drafted");

  assert.deepEqual(await recordOptOutForMember(owner.bdId, replied), { ok: true, discarded: 2 });

  for (const r of await rows([replied, drafted])) {
    assert.equal(r.state, "discarded");
    assert.equal(r.discardReason, "opt_out");
    assert.equal(r.discardedByBdId, owner.bdId);
  }
  const [sup] = await suppressionFor(p.normalized);
  assert.equal(sup?.kind, "address");
  assert.equal(sup?.source, "reply");
  assert.equal(sup?.recordedByBdId, owner.bdId);
  assert.equal((await audits([replied, drafted])).length, 2);
});

test("a repeat changes nothing: one suppression row, no second audit row", async () => {
  const { recordOptOutForMember } = await import("@/lib/sequences/optOutQueries");
  const owner = await mkOwner();
  const p = await mkPerson("repeat");
  const m = await mkMember(await mkSequence(owner), p.id, "sent");
  await recordOptOutForMember(owner.bdId, m);
  assert.deepEqual(await recordOptOutForMember(owner.bdId, m), { ok: true, discarded: 0 });
  assert.equal((await suppressionFor(p.normalized)).length, 1);
  assert.equal((await audits([m])).length, 1);
});

test("another BD cannot opt out someone else's member, and a Contact with no email cannot be suppressed", async () => {
  const { recordOptOutForMember } = await import("@/lib/sequences/optOutQueries");
  const owner = await mkOwner();
  const stranger = await mkOwner();
  const p = await mkPerson("owned");
  const m = await mkMember(await mkSequence(owner), p.id, "sent");
  assert.deepEqual(await recordOptOutForMember(stranger.bdId, m), { ok: false, error: "not_found" });
  assert.equal((await rows([m]))[0]!.state, "sent");
  assert.equal((await suppressionFor(p.normalized)).length, 0);

  const noMail = await mkPerson("nomail", false);
  const m2 = await mkMember(await mkSequence(owner), noMail.id, "sent");
  assert.deepEqual(await recordOptOutForMember(owner.bdId, m2), { ok: false, error: "no_email" });
  assert.equal((await rows([m2]))[0]!.state, "sent");
});
