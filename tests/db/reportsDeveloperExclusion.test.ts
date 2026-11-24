/**
 * The developers role group is out of the two email columns of "Actividad por BD" (Correos enviados and Personas que
 * respondieron) and out of nothing else. Against a scratch Postgres (`npm run test:db`, a loopback *_e2e database; fail-closed).
 * Every test creates its own BD, so each stands alone.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const FROM_ISO = "2026-10-01T00:00:00.000Z";
const TO_ISO = "2026-11-01T00:00:00.000Z";
const AT = new Date("2026-10-12T12:00:00Z");
const bdIds: string[] = [];
const personIds: string[] = [];
let seq = 0;

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(person).where(inArray(person.id, personIds));
  await db.delete(bd).where(inArray(bd.id, bdIds));
  await db.$client.end();
});

async function mkBd() {
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: `ZZ Dev ${++seq}`, email: `zz-dev-${run}-${seq}@example.test` }).returning();
  bdIds.push(b!.id);
  return b!.id;
}

async function mkPerson(roleGroup: string | null) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const email = `dev-${run}-${++seq}@reply.test`;
  const [p] = await db.insert(person).values({ firstName: "P", lastName: run, email, emailNormalized: email, roleGroup }).returning();
  personIds.push(p!.id);
  return p!.id;
}

async function sendTo(bdId: string, personId: string | null) {
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  await db.insert(activity).values({ personId, actorBdId: bdId, type: "email_sent", metadata: {}, createdAt: AT });
}

/** An inbound reply on a thread we opened, as the sync writes it. */
async function replyFrom(bdId: string, personId: string) {
  const { db } = await import("@/db");
  const { activity, emailMessage } = await import("@/db/schema");
  const thread = `t-${run}-${++seq}`;
  const base = { bdId, gmailThreadId: thread, personId, fromAddress: "x@reply.test", subject: "s", matchedEmail: "x@reply.test", matchConfidence: "exact" };
  await db.insert(emailMessage).values({ ...base, gmailMessageId: `o${seq}-${run}`, direction: "outbound", sentAt: new Date(AT.getTime() - 3600_000) });
  const inboundId = `i${seq}-${run}`;
  await db.insert(emailMessage).values({ ...base, gmailMessageId: inboundId, direction: "inbound", sentAt: AT });
  await db.insert(activity).values({ personId, actorBdId: bdId, type: "reply_received", metadata: { gmailMessageId: inboundId, occurredAt: AT.toISOString() }, createdAt: AT });
}

async function read(bdId: string | null) {
  const { getReportPerBd } = await import("@/lib/reports/queriesDb");
  return getReportPerBd({ fromIso: FROM_ISO, toIso: TO_ISO, fromDate: "2026-10-01", toDateExclusive: "2026-11-01", bdId });
}
async function rowOf(bdId: string) {
  return (await read(bdId)).rows.find((r) => r.bdId === bdId)!;
}

test("a reply from a developers contact does not count in 'Personas que respondieron'", async () => {
  const b = await mkBd();
  await replyFrom(b, await mkPerson("developers"));
  assert.equal((await rowOf(b)).replyPersons, 0);
});

test("an email sent to a developers contact does not count in 'Correos enviados'", async () => {
  const b = await mkBd();
  await sendTo(b, await mkPerson("developers"));
  assert.equal((await rowOf(b)).emailsSent, 0);
});

test("an email_sent with no person at all STILL counts (a left join, never an inner join)", async () => {
  const b = await mkBd();
  await sendTo(b, null);
  assert.equal((await rowOf(b)).emailsSent, 1);
});

test("an email sent to a person whose role_group is NULL still counts", async () => {
  const b = await mkBd();
  await sendTo(b, await mkPerson(null));
  assert.equal((await rowOf(b)).emailsSent, 1);
});

test("a non-developers role group counts in both email columns", async () => {
  const b = await mkBd();
  const p = await mkPerson("sales_bd");
  await sendTo(b, p);
  await replyFrom(b, p);
  const r = await rowOf(b);
  assert.equal(r.emailsSent, 1);
  assert.equal(r.replyPersons, 1);
});

test("a developers contact's activity leaves the other seven columns exactly as they were", async () => {
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  const b = await mkBd();
  const dev = await mkPerson("developers");
  const types = ["note", "call_attempt", "call", "whatsapp", "whatsapp_no_channel", "meeting_logged"] as const;
  for (const type of types) await db.insert(activity).values({ personId: dev, actorBdId: b, type, metadata: { at: AT.toISOString() }, createdAt: AT });
  const r = await rowOf(b);
  assert.deepEqual(
    { notes: r.notes, callAttempts: r.callAttempts, calls: r.calls, whatsapps: r.whatsapps, whatsappNoChannel: r.whatsappNoChannel, meetings: r.meetings, tasksCompleted: r.tasksCompleted },
    { notes: 1, callAttempts: 1, calls: 1, whatsapps: 1, whatsappNoChannel: 1, meetings: 1, tasksCompleted: 0 },
  );
});

test("replyPersonsTotal leaves developers out too, consistently with the rows", async () => {
  const b = await mkBd();
  await replyFrom(b, await mkPerson("developers"));
  await replyFrom(b, await mkPerson("sales_bd"));
  const res = await read(b);
  assert.equal(res.rows.find((r) => r.bdId === b)!.replyPersons, 1);
  assert.equal(res.replyPersonsTotal, 1);
});
