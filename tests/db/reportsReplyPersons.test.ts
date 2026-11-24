/**
 * "Personas que respondieron" on /admin/reports: DISTINCT persons with a reply_received that answers an email WE sent
 * (thread branch or header branch), against a scratch Postgres (`npm run test:db`, a loopback *_e2e database; fail-closed).
 * Fixtures are written through the same shapes the Gmail sync writes (email_message + activity carrying metadata.gmailMessageId).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const FROM_ISO = "2026-10-01T00:00:00.000Z";
const TO_ISO = "2026-11-01T00:00:00.000Z";
const T = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour));
let bdA: string;
let bdB: string;
const personIds: string[] = [];
let seq = 0;

before(async () => {
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const [a] = await db.insert(bd).values({ name: "ZZ Reply A", email: `zz-reply-a-${run}@example.test` }).returning();
  const [b] = await db.insert(bd).values({ name: "ZZ Reply B", email: `zz-reply-b-${run}@example.test` }).returning();
  bdA = a!.id;
  bdB = b!.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(person).where(inArray(person.id, personIds)); // cascades activity
  await db.delete(bd).where(inArray(bd.id, [bdA, bdB])); // cascades email_message
  await db.$client.end();
});

async function mkPerson(label: string) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const email = `${label}-${run}@reply.test`;
  const [p] = await db.insert(person).values({ firstName: label, lastName: run, email, emailNormalized: email }).returning();
  personIds.push(p!.id);
  return p!.id;
}

interface MsgInput {
  bdId: string;
  personId: string;
  direction: "inbound" | "outbound";
  thread: string;
  at: Date;
  rfcMessageId?: string | null;
  rfcReferences?: string | null;
  activityType?: "reply_received" | "auto_reply_received" | "email_bounced" | null;
}

/** An email_message row plus (for inbound) the activity the sync writes beside it. */
async function mkMsg(m: MsgInput) {
  const { db } = await import("@/db");
  const { activity, emailMessage } = await import("@/db/schema");
  const gmailMessageId = `m${++seq}-${run}`;
  await db.insert(emailMessage).values({
    bdId: m.bdId,
    gmailMessageId,
    gmailThreadId: m.thread,
    direction: m.direction,
    personId: m.personId,
    fromAddress: "x@reply.test",
    subject: "s",
    sentAt: m.at,
    rfcMessageId: m.rfcMessageId ?? null,
    rfcReferences: m.rfcReferences ?? null,
    matchedEmail: "x@reply.test",
    matchConfidence: "exact",
  });
  const type = m.activityType === undefined ? (m.direction === "inbound" ? "reply_received" : "email_sent") : m.activityType;
  if (type) {
    await db.insert(activity).values({ personId: m.personId, actorBdId: m.bdId, type, metadata: { gmailMessageId, occurredAt: m.at.toISOString() }, createdAt: m.at });
  }
}

async function figures(forBd: string | null = null) {
  const { getReportPerBd } = await import("@/lib/reports/queriesDb");
  const res = await getReportPerBd({ fromIso: FROM_ISO, toIso: TO_ISO, fromDate: "2026-10-01", toDateExclusive: "2026-11-01", bdId: forBd });
  return { mine: (id: string) => res.rows.find((r) => r.bdId === id)!.replyPersons, total: res.replyPersonsTotal };
}

test("an inbound from a known contact with NO outbound of ours behind it does not count", async () => {
  const p = await mkPerson("no-outbound");
  await mkMsg({ bdId: bdA, personId: p, direction: "inbound", thread: `t-none-${run}`, at: T(5) });
  assert.equal((await figures(bdA)).mine(bdA), 0);
});

test("an inbound whose thread carries our earlier outbound counts (thread branch)", async () => {
  const p = await mkPerson("thread");
  await mkMsg({ bdId: bdA, personId: p, direction: "outbound", thread: `t-thr-${run}`, at: T(5, 9) });
  await mkMsg({ bdId: bdA, personId: p, direction: "inbound", thread: `t-thr-${run}`, at: T(5, 10) });
  assert.equal((await figures(bdA)).mine(bdA), 1);
});

test("an inbound whose rfc_references names our outbound counts even when the gmail thread differs (header branch)", async () => {
  const p = await mkPerson("header");
  await mkMsg({ bdId: bdA, personId: p, direction: "outbound", thread: `t-h1-${run}`, at: T(6, 9), rfcMessageId: `<out-${run}@mail.test>` });
  await mkMsg({ bdId: bdA, personId: p, direction: "inbound", thread: `t-h2-${run}`, at: T(6, 10), rfcReferences: `<other@x> <out-${run}@mail.test>` });
  assert.equal((await figures(bdA)).mine(bdA), 2);
});

test("an inbound whose thread carries an outbound of ours sent AFTER it does not count", async () => {
  const p = await mkPerson("after");
  await mkMsg({ bdId: bdA, personId: p, direction: "inbound", thread: `t-after-${run}`, at: T(7, 9) });
  await mkMsg({ bdId: bdA, personId: p, direction: "outbound", thread: `t-after-${run}`, at: T(7, 10) });
  assert.equal((await figures(bdA)).mine(bdA), 2, "unchanged from the previous test's two persons");
});

test("two inbound messages from the SAME person count as one", async () => {
  const p = await mkPerson("twice");
  await mkMsg({ bdId: bdA, personId: p, direction: "outbound", thread: `t-twice-${run}`, at: T(8, 9) });
  await mkMsg({ bdId: bdA, personId: p, direction: "inbound", thread: `t-twice-${run}`, at: T(8, 10) });
  await mkMsg({ bdId: bdA, personId: p, direction: "inbound", thread: `t-twice-${run}`, at: T(8, 11) });
  assert.equal((await figures(bdA)).mine(bdA), 3, "one more person, not two more");
});

test("auto_reply_received and email_bounced on a thread we opened never count", async () => {
  const p = await mkPerson("machine");
  await mkMsg({ bdId: bdA, personId: p, direction: "outbound", thread: `t-mach-${run}`, at: T(9, 9) });
  await mkMsg({ bdId: bdA, personId: p, direction: "inbound", thread: `t-mach-${run}`, at: T(9, 10), activityType: "auto_reply_received" });
  await mkMsg({ bdId: bdA, personId: p, direction: "inbound", thread: `t-mach-${run}`, at: T(9, 11), activityType: "email_bounced" });
  assert.equal((await figures(bdA)).mine(bdA), 3, "unchanged");
});

test("the total row is not the sum of the per-BD rows when one person replied to two BDs", async () => {
  const p = await mkPerson("both");
  for (const bdId of [bdA, bdB]) {
    await mkMsg({ bdId, personId: p, direction: "outbound", thread: `t-both-${bdId}-${run}`, at: T(10, 9) });
    await mkMsg({ bdId, personId: p, direction: "inbound", thread: `t-both-${bdId}-${run}`, at: T(10, 10) });
  }
  const f = await figures(null);
  const { getReportPerBd } = await import("@/lib/reports/queriesDb");
  const res = await getReportPerBd({ fromIso: FROM_ISO, toIso: TO_ISO, fromDate: "2026-10-01", toDateExclusive: "2026-11-01", bdId: null });
  const sumOfRows = res.rows.reduce((s, r) => s + r.replyPersons, 0);
  assert.equal(f.mine(bdA), 4);
  assert.equal(f.mine(bdB), 1);
  assert.equal(sumOfRows - f.total, 1, "the shared person is counted in both rows but once in the total");
});
