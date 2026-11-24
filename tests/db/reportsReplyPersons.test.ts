/**
 * "Personas que respondieron" on /admin/reports: DISTINCT persons with a reply_received that answers an email WE sent
 * (thread branch or header branch), against a scratch Postgres (`npm run test:db`, a loopback *_e2e database; fail-closed).
 * Every test creates its own BDs and persons, so each stands alone and none depends on another having run.
 * Fixtures are written through the same shapes the Gmail sync writes (email_message + activity carrying metadata.gmailMessageId).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const FROM_ISO = "2026-10-01T00:00:00.000Z";
const TO_ISO = "2026-11-01T00:00:00.000Z";
const T = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour));
const bdIds: string[] = [];
const personIds: string[] = [];
let seq = 0;

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(person).where(inArray(person.id, personIds)); // cascades activity
  await db.delete(bd).where(inArray(bd.id, bdIds)); // cascades email_message
  await db.$client.end();
});

async function mkBd(label: string) {
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: `ZZ Reply ${label}`, email: `zz-reply-${label}-${run}-${++seq}@example.test` }).returning();
  bdIds.push(b!.id);
  return b!.id;
}

async function mkPerson(label: string) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const email = `${label}-${run}-${++seq}@reply.test`;
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

async function read(forBd: string | null, fromIso = FROM_ISO, toIso = TO_ISO) {
  const { getReportPerBd } = await import("@/lib/reports/queriesDb");
  return getReportPerBd({ fromIso, toIso, fromDate: "2026-10-01", toDateExclusive: "2026-11-01", bdId: forBd });
}
async function replyPersonsOf(id: string, fromIso = FROM_ISO, toIso = TO_ISO) {
  return (await read(id, fromIso, toIso)).rows.find((r) => r.bdId === id)!.replyPersons;
}

test("an inbound from a known contact with NO outbound of ours behind it does not count", async () => {
  const a = await mkBd("a");
  await mkMsg({ bdId: a, personId: await mkPerson("no-outbound"), direction: "inbound", thread: `t-none-${run}`, at: T(5) });
  assert.equal(await replyPersonsOf(a), 0);
});

test("an inbound whose thread carries our earlier outbound counts (thread branch)", async () => {
  const a = await mkBd("a");
  const p = await mkPerson("thread");
  await mkMsg({ bdId: a, personId: p, direction: "outbound", thread: `t-thr-${run}`, at: T(5, 9) });
  await mkMsg({ bdId: a, personId: p, direction: "inbound", thread: `t-thr-${run}`, at: T(5, 10) });
  assert.equal(await replyPersonsOf(a), 1);
});

test("an inbound whose rfc_references names our outbound counts even when the gmail thread differs (header branch)", async () => {
  const a = await mkBd("a");
  const p = await mkPerson("header");
  await mkMsg({ bdId: a, personId: p, direction: "outbound", thread: `t-h1-${run}`, at: T(6, 9), rfcMessageId: `<out-${run}@mail.test>` });
  await mkMsg({ bdId: a, personId: p, direction: "inbound", thread: `t-h2-${run}`, at: T(6, 10), rfcReferences: `<other@x> <out-${run}@mail.test>` });
  assert.equal(await replyPersonsOf(a), 1);
});

test("an inbound whose thread carries an outbound of ours sent AFTER it does not count", async () => {
  const a = await mkBd("a");
  const p = await mkPerson("after");
  await mkMsg({ bdId: a, personId: p, direction: "inbound", thread: `t-after-${run}`, at: T(7, 9) });
  await mkMsg({ bdId: a, personId: p, direction: "outbound", thread: `t-after-${run}`, at: T(7, 10) });
  assert.equal(await replyPersonsOf(a), 0);
});

test("two inbound messages from the SAME person count as one", async () => {
  const a = await mkBd("a");
  const p = await mkPerson("twice");
  await mkMsg({ bdId: a, personId: p, direction: "outbound", thread: `t-twice-${run}`, at: T(8, 9) });
  await mkMsg({ bdId: a, personId: p, direction: "inbound", thread: `t-twice-${run}`, at: T(8, 10) });
  await mkMsg({ bdId: a, personId: p, direction: "inbound", thread: `t-twice-${run}`, at: T(8, 11) });
  assert.equal(await replyPersonsOf(a), 1);
});

test("auto_reply_received and email_bounced on a thread we opened never count", async () => {
  const a = await mkBd("a");
  const p = await mkPerson("machine");
  await mkMsg({ bdId: a, personId: p, direction: "outbound", thread: `t-mach-${run}`, at: T(9, 9) });
  await mkMsg({ bdId: a, personId: p, direction: "inbound", thread: `t-mach-${run}`, at: T(9, 10), activityType: "auto_reply_received" });
  await mkMsg({ bdId: a, personId: p, direction: "inbound", thread: `t-mach-${run}`, at: T(9, 11), activityType: "email_bounced" });
  assert.equal(await replyPersonsOf(a), 0);
});

test("a send in September answered in October counts in October, the reply's period", async () => {
  const a = await mkBd("a");
  const p = await mkPerson("crossmonth");
  await mkMsg({ bdId: a, personId: p, direction: "outbound", thread: `t-cm-${run}`, at: new Date(Date.UTC(2026, 8, 20, 9)) });
  await mkMsg({ bdId: a, personId: p, direction: "inbound", thread: `t-cm-${run}`, at: T(3) });
  assert.equal(await replyPersonsOf(a), 1);
});

test("a reply dated outside the window does not count", async () => {
  const a = await mkBd("a");
  const p = await mkPerson("outside");
  await mkMsg({ bdId: a, personId: p, direction: "outbound", thread: `t-out-${run}`, at: T(5, 9) });
  await mkMsg({ bdId: a, personId: p, direction: "inbound", thread: `t-out-${run}`, at: new Date(Date.UTC(2026, 10, 3, 10)) }); // November
  assert.equal(await replyPersonsOf(a), 0);
});

test("the thread branch is bd-scoped: another BD's outbound on the same thread id does not count for this BD", async () => {
  const a = await mkBd("a");
  const b = await mkBd("b");
  const p = await mkPerson("threadscope");
  await mkMsg({ bdId: b, personId: p, direction: "outbound", thread: `t-ts-${run}`, at: T(5, 9) });
  await mkMsg({ bdId: a, personId: p, direction: "inbound", thread: `t-ts-${run}`, at: T(5, 10) });
  assert.equal(await replyPersonsOf(a), 0);
});

test("the header branch is bd-scoped: another BD's rfc_message_id in this BD's rfc_references does not count (cc'd BD gets no credit)", async () => {
  const a = await mkBd("a");
  const b = await mkBd("b");
  const p = await mkPerson("headerscope");
  await mkMsg({ bdId: b, personId: p, direction: "outbound", thread: `t-hs1-${run}`, at: T(5, 9), rfcMessageId: `<bsent-${run}@mail.test>` });
  await mkMsg({ bdId: a, personId: p, direction: "inbound", thread: `t-hs2-${run}`, at: T(5, 10), rfcReferences: `<bsent-${run}@mail.test>` });
  assert.equal(await replyPersonsOf(a), 0);
});

test("a NULL rfc_references neither breaks the query nor satisfies the header branch", async () => {
  const a = await mkBd("a");
  const p = await mkPerson("nullrefs");
  await mkMsg({ bdId: a, personId: p, direction: "outbound", thread: `t-nr1-${run}`, at: T(5, 9), rfcMessageId: `<nr-${run}@mail.test>` });
  await mkMsg({ bdId: a, personId: p, direction: "inbound", thread: `t-nr2-${run}`, at: T(5, 10), rfcReferences: null });
  assert.equal(await replyPersonsOf(a), 0);
});

test("the total row is not the sum of the per-BD rows when one person replied to two BDs", async () => {
  const a = await mkBd("a");
  const b = await mkBd("b");
  const p = await mkPerson("both");
  for (const bdId of [a, b]) {
    await mkMsg({ bdId, personId: p, direction: "outbound", thread: `t-both-${bdId}-${run}`, at: T(10, 9) });
    await mkMsg({ bdId, personId: p, direction: "inbound", thread: `t-both-${bdId}-${run}`, at: T(10, 10) });
  }
  const res = await read(null);
  const rowOf = (id: string) => res.rows.find((r) => r.bdId === id)!.replyPersons;
  assert.equal(rowOf(a), 1);
  assert.equal(rowOf(b), 1);
  const sumOfRows = res.rows.reduce((s, r) => s + r.replyPersons, 0);
  assert.equal(sumOfRows - res.replyPersonsTotal, 1, "the shared person is counted in both rows but once in the total");
});

test("replyPersonsTotal honours the bdId filter", async () => {
  const a = await mkBd("a");
  const b = await mkBd("b");
  const pa = await mkPerson("filter-a");
  const pb = await mkPerson("filter-b");
  await mkMsg({ bdId: a, personId: pa, direction: "outbound", thread: `t-fa-${run}`, at: T(11, 9) });
  await mkMsg({ bdId: a, personId: pa, direction: "inbound", thread: `t-fa-${run}`, at: T(11, 10) });
  await mkMsg({ bdId: b, personId: pb, direction: "outbound", thread: `t-fb-${run}`, at: T(11, 9) });
  await mkMsg({ bdId: b, personId: pb, direction: "inbound", thread: `t-fb-${run}`, at: T(11, 10) });
  assert.equal((await read(a)).replyPersonsTotal, 1, "only A's person, not B's");
});
