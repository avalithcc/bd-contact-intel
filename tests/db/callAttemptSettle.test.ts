/**
 * "Más detalles…" against a real database: the full call form settles the SAME
 * call attempt. One `call` row carrying the dialled number, the attempt folded
 * into it, status recomputed, and a second settle refused. Opt-in and
 * fail-closed like the other files here (`npm run test:db`, a loopback *_e2e database).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const MOBILE = "+5491141234567";
let bdId: string;
let otherBdId: string;
let personId: string;

before(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const bds = await db
    .insert(bd)
    .values([
      { name: "ZZ Caller", email: `zz-caller-${run}@example.test` },
      { name: "ZZ Other", email: `zz-other-${run}@example.test` },
    ])
    .returning();
  bdId = bds[0]!.id;
  otherBdId = bds[1]!.id;
  const [p] = await db
    .insert(person)
    .values({ firstName: "Call", lastName: run, email: `call-${run}@prospect.test`, emailNormalized: `call-${run}@prospect.test`, ownerBdId: bdId, phone: "+541143210000", mobilePhone: MOBILE })
    .returning();
  personId = p!.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  await db.delete(person).where(eq(person.id, personId)); // cascades activity
  await db.delete(bd).where(inArray(bd.id, [bdId, otherBdId]));
});

const callsAndAttempts = async () => {
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  const { and, eq, inArray } = await import("drizzle-orm");
  return db.select().from(activity).where(and(eq(activity.personId, personId), inArray(activity.type, ["call", "call_attempt"])));
};

test("settling with the full form writes one call with the dialled number and folds the attempt", async () => {
  const { recordCallAttempt, settleCallAttempt } = await import("@/lib/contacts/callAttemptDb");
  const attempt = await recordCallAttempt(personId, bdId, MOBILE);
  assert.equal(attempt.field, "mobile_phone");

  const { callId } = await settleCallAttempt(attempt.attemptId, personId, bdId, { outcome: "no_answer", date: "", time: "", notes: " nadie atendió " });

  const rows = await callsAndAttempts();
  const calls = rows.filter((r) => r.type === "call");
  assert.equal(calls.length, 1, "one call, never a duplicate");
  assert.equal(calls[0]!.id, callId);
  const meta = calls[0]!.metadata as Record<string, unknown>;
  assert.equal(meta.number, MOBILE);
  assert.equal(meta.outcome, "no_answer");
  assert.equal(meta.notes, "nadie atendió");
  const closed = rows.find((r) => r.type === "call_attempt")!.metadata as Record<string, unknown>;
  assert.equal(closed.callActivityId, callId);
  assert.equal(closed.outcome, "no_answer");

  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [p] = await db.select({ status: person.status }).from(person).where(eq(person.id, personId));
  assert.equal(p!.status, "contacted", "an outbound call is contact evidence");
});

test("a settled attempt cannot be settled again and writes no second call", async () => {
  const { recordCallAttempt, settleCallAttempt, CallAttemptNotFoundError } = await import("@/lib/contacts/callAttemptDb");
  const { CallAttemptResolvedError } = await import("@/lib/contacts/callAttempt");
  const attempt = await recordCallAttempt(personId, bdId, "+541143210000");
  await settleCallAttempt(attempt.attemptId, personId, bdId, { outcome: "connected", date: "", time: "", notes: "" });
  await assert.rejects(
    settleCallAttempt(attempt.attemptId, personId, bdId, { outcome: "busy", date: "", time: "", notes: "" }),
    CallAttemptResolvedError,
  );
  // Another BD cannot settle someone else's attempt.
  await assert.rejects(settleCallAttempt(attempt.attemptId, personId, otherBdId, { outcome: "busy", date: "", time: "", notes: "" }), CallAttemptNotFoundError);
  const calls = (await callsAndAttempts()).filter((r) => r.type === "call");
  assert.equal(calls.length, 2, "one call per dial: the first test's plus this one");
});
