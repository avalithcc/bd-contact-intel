/**
 * DB-backed check of thread attribution end to end: the real getOutboundThreadRefs read, the real
 * classifier output, and the real writeSyncedMessages. Opt-in and fail-closed like the other files
 * here (`npm run test:db`, a loopback *_e2e database). Rows live under a per-run token and are removed afterwards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const BD_EMAIL = `zz-thread-${run}@example.test`;
let bdId: string;
let jonathan: string;
let maria: string;
const personIds: string[] = [];

async function sentTo(personId: string, o: { gid: string; thread: string; mid: string }) {
  const { db } = await import("@/db");
  const { emailMessage, emailMessagePerson } = await import("@/db/schema");
  const [m] = await db
    .insert(emailMessage)
    .values({
      bdId, gmailMessageId: o.gid, gmailThreadId: o.thread, direction: "outbound", personId, fromAddress: BD_EMAIL,
      toAddresses: ["guess@guess.test"], sentAt: new Date("2026-10-10T10:00:00Z"), rfcMessageId: o.mid, matchedEmail: "guess@guess.test", matchConfidence: "inferred",
    })
    .returning();
  await db.insert(emailMessagePerson).values({ emailMessageId: m.id, personId, matchedEmail: "guess@guess.test", matchConfidence: "inferred" });
}

async function incoming(gid: string, thread: string, from: string, extra: { name: string; value: string }[] = []) {
  const { parseGmailMessage } = await import("@/lib/gmail/parseMessage");
  const { classifyGmailMessage } = await import("@/lib/gmail/classify");
  const parsed = parseGmailMessage({
    id: gid, threadId: thread, internalDate: String(Date.UTC(2026, 9, 12)),
    payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "To", value: BD_EMAIL }, ...extra], body: { data: Buffer.from("ok").toString("base64url") } },
  });
  return classifyGmailMessage({ message: parsed, bdEmail: BD_EMAIL, knownPersons: [], neverLogRules: [] });
}

before(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: "ZZ Thread", email: BD_EMAIL }).returning();
  bdId = b.id;
  const rows = await db
    .insert(person)
    .values([
      { firstName: "Jonathan", lastName: run, email: `jon-${run}@guess.test`, emailNormalized: `jon-${run}@guess.test`, emailStatus: "probable", emailSource: "pattern_inferred" },
      { firstName: "Maria", lastName: run },
    ])
    .returning();
  jonathan = rows[0]!.id;
  maria = rows[1]!.id;
  personIds.push(jonathan, maria);
  await sentTo(jonathan, { gid: `g-out-1-${run}`, thread: `t-1-${run}`, mid: `<out1-${run}@mail>` });
  await sentTo(jonathan, { gid: `g-out-2-${run}`, thread: `t-2-${run}`, mid: `<out2-${run}@mail>` });
  await sentTo(maria, { gid: `g-out-3-${run}`, thread: `t-2-${run}`, mid: `<out3-${run}@mail>` });
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  await db.delete(person).where(inArray(person.id, personIds)); // cascades activity and email_message_person
  await db.delete(bd).where(eq(bd.id, bdId)); // cascades email_message
});

test("a reply from another mailbox is stored, replied, and leaves the address and email_status alone", async () => {
  const { attributeUnmatchedByThread } = await import("@/lib/gmail/threadAttribution");
  const { getOutboundThreadRefs, getOwnMailboxAddresses, writeSyncedMessages } = await import("@/lib/gmail/syncQueries");
  const { db } = await import("@/db");
  const { activity, emailMessage, emailMessagePerson, person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  const viaThread = await incoming(`g-in-1-${run}`, `t-1-${run}`, "Jon P <jon.personal@other.test>");
  const viaHeader = await incoming(`g-in-2-${run}`, `t-unknown-${run}`, "jon.work@other.test", [{ name: "In-Reply-To", value: `<out1-${run}@mail>` }]);
  const ambiguous = await incoming(`g-in-3-${run}`, `t-2-${run}`, "who@other.test");
  const out = await attributeUnmatchedByThread([viaThread, viaHeader, ambiguous], { bdEmail: BD_EMAIL, neverLogRules: [] }, { getOutboundThreadRefs: (q) => getOutboundThreadRefs(bdId, q), getOwnMailboxAddresses });
  assert.deepEqual(out.map((m) => m.matches.length), [1, 1, 0]);

  const written = await writeSyncedMessages(bdId, out.filter((m) => m.matches.length > 0));
  assert.equal(written.inserted, 2);

  const rows = await db.select().from(emailMessage).where(eq(emailMessage.gmailMessageId, `g-in-1-${run}`));
  assert.equal(rows[0]!.personId, jonathan);
  assert.equal(rows[0]!.matchConfidence, "thread");
  assert.equal(rows[0]!.matchedEmail, "jon.personal@other.test");
  const links = await db.select().from(emailMessagePerson).where(eq(emailMessagePerson.emailMessageId, rows[0]!.id));
  assert.deepEqual(links.map((l) => [l.personId, l.matchConfidence]), [[jonathan, "thread"]]);

  const acts = await db.select().from(activity).where(eq(activity.personId, jonathan));
  assert.equal(acts.filter((a) => a.type === "reply_received").length, 2);
  const [p] = await db.select().from(person).where(eq(person.id, jonathan));
  assert.equal(p!.status, "replied");
  assert.equal(p!.email, `jon-${run}@guess.test`);
  assert.equal(p!.emailStatus, "probable"); // not promoted: the address that answered is not the one we hold
});

test("the misattributed-inbound cleanup selection never returns a thread-attributed row", async () => {
  const { readWrongMatches } = await import("@/lib/gmail/misattributedInbound");
  const { db } = await import("@/db");
  const { emailMessage, emailMessagePerson } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [thread] = await db.select().from(emailMessage).where(eq(emailMessage.gmailMessageId, `g-in-1-${run}`));
  assert.ok(thread, "the previous test stored the thread-attributed message");

  // Control: the same shape with match_confidence 'inferred' IS selected, so the exclusion is what protects the thread row.
  const [control] = await db
    .insert(emailMessage)
    .values({ bdId, gmailMessageId: `g-ctl-${run}`, gmailThreadId: `t-ctl-${run}`, direction: "inbound", personId: maria, fromAddress: "nobody@other.test", sentAt: new Date(), matchedEmail: "maria@x.test", matchConfidence: "inferred" })
    .returning();
  await db.insert(emailMessagePerson).values({ emailMessageId: control!.id, personId: maria, matchedEmail: "maria@x.test", matchConfidence: "inferred" });

  const wrong = await readWrongMatches(db);
  assert.ok(wrong.some((w) => w.emailMessageId === control!.id));
  assert.ok(!wrong.some((w) => w.emailMessageId === thread.id));
});
