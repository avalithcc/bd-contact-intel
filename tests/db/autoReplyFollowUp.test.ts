/**
 * End to end through the real sync write, the real status recompute and the real follow-up SQL:
 * an out-of-office does not make a Contact `replied`, does not reset the follow-up clock, and so
 * the Contact is still due in the queue; a genuine reply (the control) keeps its old behaviour.
 * Opt-in and fail-closed like the other files here (`npm run test:db`, a loopback *_e2e database).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const BD_EMAIL = `zz-auto-${run}@example.test`;
const DAY = 24 * 60 * 60 * 1000;
let bdId: string;
let away: string;
let answered: string;
const emailOf = (who: string) => `${who}-${run}@prospect.test`;

async function inbound(gid: string, from: string, at: Date, extra: { name: string; value: string }[]) {
  const { parseGmailMessage } = await import("@/lib/gmail/parseMessage");
  const { classifyGmailMessage } = await import("@/lib/gmail/classify");
  const parsed = parseGmailMessage({
    id: gid, threadId: `t-${gid}`, internalDate: String(at.getTime()),
    payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "To", value: BD_EMAIL }, ...extra], body: { data: Buffer.from("ok").toString("base64url") } },
  });
  return classifyGmailMessage({
    message: parsed, bdEmail: BD_EMAIL, neverLogRules: [],
    knownPersons: [
      { personId: away, emailNormalized: emailOf("away"), confidence: "exact" },
      { personId: answered, emailNormalized: emailOf("answered"), confidence: "exact" },
    ],
  });
}

before(async () => {
  const { db } = await import("@/db");
  const { activity, bd, person } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: "ZZ Auto", email: BD_EMAIL }).returning();
  bdId = b!.id;
  const rows = await db
    .insert(person)
    .values(["away", "answered"].map((who) => ({ firstName: who, lastName: run, email: emailOf(who), emailNormalized: emailOf(who), ownerBdId: bdId, status: "contacted" })))
    .returning();
  away = rows[0]!.id;
  answered = rows[1]!.id;
  // We wrote to both 8 days ago (a `contacted` Contact is due after 7 quiet days).
  const sentAt = new Date(Date.now() - 8 * DAY);
  await db.insert(activity).values([away, answered].map((personId) => ({ personId, actorBdId: bdId, type: "email_sent", metadata: {}, createdAt: sentAt })));
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  await db.delete(person).where(inArray(person.id, [away, answered])); // cascades activity and queue items
  await db.delete(bd).where(eq(bd.id, bdId));
});

test("an out-of-office keeps the Contact contacted, leaves the clock at our send, and the Contact is due in the queue; a genuine reply is the control", async () => {
  const { writeSyncedMessages } = await import("@/lib/gmail/syncQueries");
  const { buildFollowUpInsertQuery } = await import("@/lib/followUp/candidateQuery");
  const { db } = await import("@/db");
  const { activity, followUpQueueItem, person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  const yesterday = new Date(Date.now() - DAY);
  const ooo = await inbound(`g-ooo-${run}`, `Away <${emailOf("away")}>`, yesterday, [{ name: "Subject", value: "Automatic reply: intro" }, { name: "Auto-Submitted", value: "auto-replied" }]);
  const genuine = await inbound(`g-real-${run}`, `Answered <${emailOf("answered")}>`, yesterday, [{ name: "Subject", value: "Re: intro" }]);
  assert.equal(ooo.automated, true);
  assert.equal(genuine.automated, false);
  assert.equal((await writeSyncedMessages(bdId, [ooo, genuine])).inserted, 2);

  const types = async (personId: string) => (await db.select().from(activity).where(eq(activity.personId, personId))).map((a) => a.type).sort();
  assert.deepEqual(await types(away), ["auto_reply_received", "email_sent"]);
  assert.deepEqual(await types(answered), ["email_sent", "reply_received"]);

  const status = async (personId: string) => (await db.select().from(person).where(eq(person.id, personId)))[0]!.status;
  assert.equal(await status(away), "contacted");
  assert.equal(await status(answered), "replied"); // regression: a genuine reply moves the stage exactly as before

  await db.execute(buildFollowUpInsertQuery(bdId, new Date().toISOString().slice(0, 10)));
  const queued = await db.select().from(followUpQueueItem).where(eq(followUpQueueItem.bdId, bdId));
  const byPerson = new Map(queued.map((q) => [q.personId, q]));

  const mine = byPerson.get(away);
  assert.ok(mine, "the out-of-office Contact is in the follow-up queue");
  assert.equal(mine.dueStatus, "contacted");
  // The clock still reads OUR send (8 days ago), not the robot's answer (1 day ago).
  assert.ok(Math.abs(new Date(mine.lastTouchAt).getTime() - (Date.now() - 8 * DAY)) < 60_000, "last touch is our email, not the auto-reply");

  assert.equal(byPerson.has(answered), false, "control: a genuine reply yesterday means replied and not yet due (3-day rule)");
});
