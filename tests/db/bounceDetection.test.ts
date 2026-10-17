/**
 * DB-backed tests for bounce detection (recordBounces): one transaction per run that marks the address bounced,
 * suppresses it, stops the live Sequence memberships, cancels pending scheduled sends and writes the timeline entry; a
 * repeat of the same notification changes nothing; a notification we cannot tie to our own mail does nothing.
 * Opt-in and fail-closed: `npm run test:db`, DATABASE_URL naming a `*_e2e` database on loopback.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const bdIds: string[] = [];
const personIds: string[] = [];
const addresses: string[] = [];
let n = 0;

async function seed(opts: { withOutbound?: boolean } = {}) {
  const { db } = await import("@/db");
  const { bd, emailAccount, emailMessage, person, scheduledEmail, sequence, sequenceMember } = await import("@/db/schema");
  const i = ++n;
  const [b] = await db.insert(bd).values({ name: `ZZ Bounce ${run} ${i}`, email: `zz-bn-${run}-${i}@example.test` }).returning();
  bdIds.push(b!.id);
  const [acc] = await db.insert(emailAccount).values({ bdId: b!.id, emailAddress: `zz-bn-sender-${run}-${i}@example.test` }).returning();
  const address = `zz-bn-lucia-${run}-${i}@example.test`;
  addresses.push(address);
  const [p] = await db.insert(person).values({ firstName: "Lucia", lastName: run, email: address, emailNormalized: address, emailStatus: "verified" }).returning();
  personIds.push(p!.id);
  const [s] = await db.insert(sequence).values({ name: `Outreach CTO ${run} ${i}`, ownerBdId: b!.id, emailAccountId: acc!.id, schedule: {} }).returning();
  const [member] = await db.insert(sequenceMember).values({ sequenceId: s!.id, personId: p!.id, state: "sent", sentAt: new Date("2026-10-08T13:00:00Z") }).returning();
  const [pending] = await db.insert(scheduledEmail).values({ bdId: b!.id, personId: p!.id, toAddress: address, subject: "later", body: "b", sendAt: new Date(Date.now() + 3_600_000) }).returning();
  const threadId = `th-${run}-${i}`;
  const rfcId = `<orig-${run}-${i}@mail.gmail.com>`;
  if (opts.withOutbound !== false) {
    await db.insert(emailMessage).values({
      bdId: b!.id, gmailMessageId: `gm-${run}-${i}`, gmailThreadId: threadId, direction: "outbound", personId: p!.id, fromAddress: acc!.emailAddress,
      toAddresses: [address], subject: "Squads nearshore para Acme", sentAt: new Date("2026-10-08T13:00:00Z"), rfcMessageId: rfcId, matchedEmail: address, matchConfidence: "exact",
    });
  }
  return { bdId: b!.id, personId: p!.id, address, memberId: member!.id, pendingId: pending!.id, threadId, rfcId, sequenceName: s!.name, i };
}

// Real producers: the notification is a Gmail payload run through the real parser.
async function notification(kind: "hard" | "soft", s: Awaited<ReturnType<typeof seed>>, id: string) {
  const { parseBounce } = await import("@/lib/gmail/parseBounce");
  const { gmailDelay422, gmailHard511 } = await import("../unit/bounceFixtures");
  const make = kind === "hard" ? gmailHard511 : gmailDelay422;
  const parsed = parseBounce(make({ id, threadId: s.threadId, address: s.address, originalId: s.rfcId }));
  assert.ok(parsed);
  return parsed;
}
const hard = (s: Awaited<ReturnType<typeof seed>>, id = `dsn-h-${run}-${s.i}`) => notification("hard", s, id);
const soft = (s: Awaited<ReturnType<typeof seed>>, id = `dsn-s-${run}-${s.i}`) => notification("soft", s, id);

async function state(s: Awaited<ReturnType<typeof seed>>) {
  const { db } = await import("@/db");
  const { activity, emailSuppression, person, scheduledEmail, sequenceMember, personPropertyHistory } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const [p] = await db.select().from(person).where(eq(person.id, s.personId));
  const [m] = await db.select().from(sequenceMember).where(eq(sequenceMember.id, s.memberId));
  const [sched] = await db.select().from(scheduledEmail).where(eq(scheduledEmail.id, s.pendingId));
  return {
    status: p!.emailStatus,
    member: m!,
    sched: sched!,
    suppressions: await db.select().from(emailSuppression).where(eq(emailSuppression.value, s.address)),
    activities: await db.select().from(activity).where(and(eq(activity.personId, s.personId), eq(activity.type, "email_bounced"))),
    history: await db.select().from(personPropertyHistory).where(and(eq(personPropertyHistory.personId, s.personId), eq(personPropertyHistory.source, "bounce"))),
  };
}

after(async () => {
  const { db } = await import("@/db");
  const { bd, emailSuppression, sequence } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (bdIds.length) await db.delete(sequence).where(inArray(sequence.ownerBdId, bdIds));
  if (addresses.length) await db.delete(emailSuppression).where(inArray(emailSuppression.value, addresses));
  if (bdIds.length) await db.delete(bd).where(inArray(bd.id, bdIds));
  const { person } = await import("@/db/schema");
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
});

test("a hard bounce marks the person, suppresses the address, stops the sequence, cancels the scheduled send and logs it", async () => {
  const { recordBounces } = await import("@/lib/gmail/bounceQueries");
  const s = await seed();
  const result = await recordBounces(s.bdId, [await hard(s)]);
  assert.deepEqual(result, { hard: 1, soft: 0, unlinked: 0, duplicates: 0, failed: 0, scheduledCancelled: 1, membersDiscarded: 1 });
  const after = await state(s);
  assert.equal(after.status, "bounced");
  assert.equal(after.suppressions.length, 1);
  assert.equal(after.suppressions[0]!.source, "bounce");
  assert.equal(after.suppressions[0]!.personId, s.personId);
  assert.equal(after.member.state, "discarded");
  assert.equal(after.member.discardReason, "bounce");
  assert.equal(after.sched.status, "cancelled");
  assert.equal(after.history.length, 1);
  assert.equal(after.history[0]!.oldValue, "verified");
  assert.equal(after.history[0]!.newValue, "bounced");
  assert.equal(after.activities.length, 1);
  const meta = after.activities[0]!.metadata as Record<string, unknown>;
  assert.equal(meta.severity, "hard");
  assert.equal(meta.address, s.address);
  assert.equal(meta.statusCode, "5.1.1");
  assert.equal(meta.reasonKey, "mailbox_not_found");
  assert.equal(meta.originalSubject, "Squads nearshore para Acme");
  assert.deepEqual(meta.sequenceNames, [s.sequenceName]);
  assert.equal(meta.scheduledCancelled, 1);
  assert.equal(after.activities[0]!.actorBdId, s.bdId);
});

test("re-syncing the same notification changes nothing", async () => {
  const { recordBounces } = await import("@/lib/gmail/bounceQueries");
  const s = await seed();
  await recordBounces(s.bdId, [await hard(s)]);
  const again = await recordBounces(s.bdId, [await hard(s)]);
  assert.deepEqual(again, { hard: 0, soft: 0, unlinked: 0, duplicates: 1, failed: 0, scheduledCancelled: 0, membersDiscarded: 0 });
  const after = await state(s);
  assert.equal(after.activities.length, 1);
  assert.equal(after.suppressions.length, 1);
  assert.equal(after.history.length, 1);
});

test("a second notification for an already bounced address adds its entry but no second status change or suppression", async () => {
  const { recordBounces } = await import("@/lib/gmail/bounceQueries");
  const s = await seed();
  await recordBounces(s.bdId, [await hard(s)]);
  await recordBounces(s.bdId, [await hard(s, `dsn-h2-${run}-${s.i}`)]);
  const after = await state(s);
  assert.equal(after.activities.length, 2);
  assert.equal(after.suppressions.length, 1);
  assert.equal(after.history.length, 1);
});

test("a soft bounce only writes a timeline entry", async () => {
  const { recordBounces } = await import("@/lib/gmail/bounceQueries");
  const s = await seed();
  const result = await recordBounces(s.bdId, [await soft(s)]);
  assert.equal(result.soft, 1);
  assert.equal(result.hard, 0);
  const after = await state(s);
  assert.equal(after.status, "verified");
  assert.equal(after.suppressions.length, 0);
  assert.equal(after.member.state, "sent");
  assert.equal(after.sched.status, "scheduled");
  assert.equal(after.activities.length, 1);
  assert.equal((after.activities[0]!.metadata as Record<string, unknown>).severity, "soft");
  await recordBounces(s.bdId, [await soft(s)]);
  assert.equal((await state(s)).activities.length, 1, "a repeat of the soft notification is idempotent too");
});

test("a notification that links to nothing we sent does nothing at all", async () => {
  const { recordBounces } = await import("@/lib/gmail/bounceQueries");
  const s = await seed({ withOutbound: false });
  const result = await recordBounces(s.bdId, [await hard(s)]);
  assert.equal(result.unlinked, 1);
  assert.equal(result.hard, 0);
  const after = await state(s);
  assert.equal(after.status, "verified");
  assert.equal(after.suppressions.length, 0);
  assert.equal(after.member.state, "sent");
  assert.equal(after.sched.status, "scheduled");
  assert.equal(after.activities.length, 0);
});

test("a notification arriving in another BD's mailbox does not count: only the sender's own mail links", async () => {
  const { recordBounces } = await import("@/lib/gmail/bounceQueries");
  const s = await seed();
  const other = await seed({ withOutbound: false });
  const result = await recordBounces(other.bdId, [await hard(s)]);
  assert.equal(result.unlinked, 1);
  assert.equal((await state(s)).status, "verified");
});

test("every notification in a tick is processed, in chunks, none dropped", async () => {
  const { recordBounces, MAX_BOUNCES_PER_RUN } = await import("@/lib/gmail/bounceQueries");
  const s = await seed();
  const total = MAX_BOUNCES_PER_RUN * 2 + 20;
  const batch = [];
  for (let k = 0; k < total; k++) batch.push(await soft(s, `dsn-bulk-${run}-${s.i}-${k}`));
  const result = await recordBounces(s.bdId, batch);
  assert.equal(result.soft, total);
  assert.equal((await state(s)).activities.length, total);
});

test("one bad notification among several costs only itself: its writes roll back, the others are recorded", async () => {
  const { recordBounces } = await import("@/lib/gmail/bounceQueries");
  const s = await seed();
  const bad = await hard(s, `dsn-bad-${run}-${s.i}`);
  bad.recipients[0]!.diagnostic = "boom\u0000"; // jsonb refuses a NUL: the entry insert fails after the status was set
  const good = await soft(s, `dsn-good-${run}-${s.i}`);
  const result = await recordBounces(s.bdId, [bad, good]);
  assert.equal(result.failed, 1);
  assert.equal(result.soft, 1);
  const after = await state(s);
  assert.equal(after.status, "verified", "the failed notification's status change was rolled back with it");
  assert.equal(after.suppressions.length, 0);
  assert.equal(after.member.state, "sent");
  assert.equal(after.sched.status, "scheduled");
  assert.equal(after.activities.length, 1);
});
