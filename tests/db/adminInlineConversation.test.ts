/**
 * DB-backed check of the admin's inline conversation read (owner decision
 * 2026-10-15: visible from the start, no click, no audit row). Opt-in and
 * fail-closed like the other files here (`npm run test:db`, a loopback *_e2e
 * database). Rows live under a per-run token and are removed afterwards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const SECRET_MAIL = `SECRET-MAIL-${run}`;
const SECRET_SYNCED = `SECRET-SYNCED-${run}`;
const SECRET_LINKEDIN = `SECRET-LINKEDIN-${run}`;
const THREAD = `thread-${run}`;
const GMAIL_ID = `gmail-${run}`;
let admin: { id: string; role: string };
let owner: { id: string; role: string };
let outsider: { id: string; role: string };
let personId: string;

before(async () => {
  const { db } = await import("@/db");
  const { activity, bd, conversation, emailMessage, emailMessagePerson, message, person } = await import("@/db/schema");
  const bds = await db
    .insert(bd)
    .values([
      { name: "ZZ Admin", email: `zz-admin-${run}@example.test`, role: "admin" },
      { name: "ZZ Owner", email: `zz-owner-${run}@example.test` },
      { name: "ZZ Outsider", email: `zz-outsider-${run}@example.test` },
    ])
    .returning();
  [admin, owner, outsider] = bds as typeof bds;
  const profileKey = `linkedin.com/in/zz-${run}`;
  const [p] = await db.insert(person).values({ firstName: "Inline", lastName: run, profileKey }).returning();
  personId = p!.id;

  await db.insert(activity).values({
    personId, actorBdId: owner.id, type: "email_sent", metadata: { subject: "Hola", body: SECRET_MAIL, gmailThreadId: THREAD, gmailMessageId: GMAIL_ID },
  });
  const [m] = await db
    .insert(emailMessage)
    .values({
      bdId: owner.id, gmailMessageId: GMAIL_ID, gmailThreadId: THREAD, direction: "outbound", personId, fromAddress: owner.id,
      toAddresses: [], sentAt: new Date("2026-10-10T10:00:00Z"), matchedEmail: "x@y.test", matchConfidence: "exact",
      bodyText: SECRET_SYNCED + "x".repeat(5000),
    })
    .returning();
  await db.insert(emailMessagePerson).values({ emailMessageId: m!.id, personId, matchedEmail: "x@y.test", matchConfidence: "exact" });
  const [c] = await db.insert(conversation).values({ bdId: owner.id, externalId: `ext-${run}`, peerProfileKey: profileKey }).returning();
  await db.insert(message).values({
    bdId: owner.id, conversationId: c!.id, senderName: "ZZ Owner", sentAt: new Date("2026-10-11T10:00:00Z"), content: SECRET_LINKEDIN, contentHash: `hash-${run}`,
  });
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(person).where(inArray(person.id, [personId]));
  await db.delete(bd).where(inArray(bd.id, [admin.id, owner.id, outsider.id]));
});

async function auditRowsFor(actorId: string): Promise<number> {
  const { db } = await import("@/db");
  const { auditLog } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.actorBdId, actorId))).length;
}

test("an admin reads another BD's mail, synced body and LinkedIn messages inline, and no audit row is written", async () => {
  const { getPersonTimeline } = await import("@/lib/activity/queries");
  const { getAdminInlineConversations } = await import("@/lib/activity/adminInlineConversations");
  const { inlineEmailBody } = await import("@/lib/activity/inlineConversationGroups");

  const timeline = await getPersonTimeline(personId, admin.id, { viewerIsAdmin: true });
  const mail = timeline.entries.find((e) => e.type === "email_sent")!;
  assert.equal(mail.visible, true);
  assert.equal((mail.metadata as { body: string }).body, SECRET_MAIL);

  const inline = await getAdminInlineConversations(admin, personId, [owner.id]);
  const synced = inlineEmailBody(inline.emailBodies, THREAD, GMAIL_ID);
  assert.ok(synced?.bodyText?.startsWith(SECRET_SYNCED));
  assert.equal(synced?.bodyTruncated, true, "a 5,000-char body is cut at the per-message cap and says so");
  assert.ok(synced!.bodyText!.length <= 4000);
  assert.equal(inline.linkedin[owner.id]?.[0]?.content, SECRET_LINKEDIN);
  // A raw-shaped union must not leak driver strings into the view model.
  assert.ok(inline.linkedin[owner.id]![0]!.sentAt instanceof Date);
  assert.equal(inline.capped, false);

  assert.equal(await auditRowsFor(admin.id), 0);
});

test("a non-admin, non-owner gets no body in either payload", async () => {
  const { getPersonTimeline } = await import("@/lib/activity/queries");
  const { getAdminInlineConversations } = await import("@/lib/activity/adminInlineConversations");

  const timeline = await getPersonTimeline(personId, outsider.id);
  assert.equal(timeline.entries.find((e) => e.type === "email_sent")!.visible, false);
  // Even a caller that wrongly passes the admin flag as false-by-omission leaks nothing.
  const inline = await getAdminInlineConversations(outsider, personId, [owner.id]);
  const everything = JSON.stringify([timeline, inline]);
  for (const secret of [SECRET_MAIL, SECRET_SYNCED, SECRET_LINKEDIN]) assert.ok(!everything.includes(secret), secret);
});

test("the owner keeps reading their own conversation unchanged, and an admin-owner gets no duplicate inline copy", async () => {
  const { getPersonTimeline } = await import("@/lib/activity/queries");
  const { getAdminInlineConversations } = await import("@/lib/activity/adminInlineConversations");
  const { getThreadForDisplay } = await import("@/lib/gmail/threadMessages");
  const { getOwnConversationMessages } = await import("@/lib/activity/getOwnConversationMessages");

  const timeline = await getPersonTimeline(personId, owner.id);
  assert.equal((timeline.entries.find((e) => e.type === "email_sent")!.metadata as { body: string }).body, SECRET_MAIL);
  const thread = await getThreadForDisplay(owner.id, personId, THREAD);
  assert.ok(thread.bodies[0]?.bodyText?.startsWith(SECRET_SYNCED));
  const own = await getOwnConversationMessages(owner.id, personId);
  assert.ok(own.some((m) => m.content === SECRET_LINKEDIN));

  const ownerAsAdmin = await getAdminInlineConversations({ ...owner, role: "admin" }, personId, [owner.id]);
  assert.deepEqual(ownerAsAdmin.emailBodies, {});
  assert.deepEqual(ownerAsAdmin.linkedin, {});
});

test("the read is bounded: a row cap reports capped and keeps the newest", async () => {
  const { getAdminInlineConversations } = await import("@/lib/activity/adminInlineConversations");
  const inline = await getAdminInlineConversations(admin, personId, [owner.id], { rowLimit: 1 });
  assert.equal(inline.capped, true);
  assert.equal(Object.keys(inline.linkedin).length + Object.keys(inline.emailBodies).length, 1);
});

// A synced message with no activity row happens when the send path stores one
// email_message for several matched persons but writes its activity for only
// one of them (storeSentEmail.ts, buildSyncedActivityRows' isPlatformSent).
test("a synced message with no activity row is visible to an admin and absent from a non-admin's payload", async () => {
  const { db } = await import("@/db");
  const { emailMessage, emailMessagePerson } = await import("@/db/schema");
  const { getAdminInlineConversations } = await import("@/lib/activity/adminInlineConversations");
  const { getPersonTimeline } = await import("@/lib/activity/queries");
  const { inlineEmailBody } = await import("@/lib/activity/inlineConversationGroups");

  const ORPHAN_ID = `gmail-orphan-${run}`;
  const SECRET_ORPHAN = `SECRET-ORPHAN-${run}`;
  const [m] = await db
    .insert(emailMessage)
    .values({
      bdId: owner.id, gmailMessageId: ORPHAN_ID, gmailThreadId: `thread-orphan-${run}`, direction: "outbound", personId, fromAddress: "owner@x.test",
      toAddresses: ["jane@y.test", "bob@y.test"], subject: "Orphan subject", sentAt: new Date("2026-10-12T10:00:00Z"), matchedEmail: "jane@y.test",
      matchConfidence: "exact", bodyText: SECRET_ORPHAN,
    })
    .returning();
  await db.insert(emailMessagePerson).values({ emailMessageId: m!.id, personId, matchedEmail: "jane@y.test", matchConfidence: "exact" });

  const inline = await getAdminInlineConversations(admin, personId, [owner.id]);
  assert.deepEqual(inline.unlistedMail.map((u) => u.gmailMessageId), [ORPHAN_ID], "the message that has an activity row is not listed twice");
  const u = inline.unlistedMail[0]!;
  assert.equal(u.bdName, "ZZ Owner");
  assert.equal(u.subject, "Orphan subject");
  assert.equal(u.addr, "jane@y.test, bob@y.test");
  assert.ok(u.sentAt instanceof Date);
  assert.equal(inlineEmailBody(inline.emailBodies, u.gmailThreadId, ORPHAN_ID)?.bodyText, SECRET_ORPHAN);

  const outsiderView = await getAdminInlineConversations(outsider, personId, [owner.id]);
  const timeline = await getPersonTimeline(personId, outsider.id);
  assert.ok(!JSON.stringify([outsiderView, timeline]).includes(SECRET_ORPHAN));
  assert.equal(await auditRowsFor(admin.id), 0);
});

test("a contact whose only mail has no activity row has an empty activity timeline but one unlisted message for an admin", async () => {
  const { db } = await import("@/db");
  const { emailMessage, emailMessagePerson, person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { getAdminInlineConversations } = await import("@/lib/activity/adminInlineConversations");
  const { getPersonTimeline } = await import("@/lib/activity/queries");
  const { isTimelineEmpty } = await import("@/lib/activity/inlineConversationGroups");

  const [lonely] = await db.insert(person).values({ firstName: "Lonely", lastName: run }).returning();
  try {
    const [m] = await db
      .insert(emailMessage)
      .values({
        bdId: owner.id, gmailMessageId: `gmail-lonely-${run}`, gmailThreadId: `thread-lonely-${run}`, direction: "outbound", personId: lonely!.id,
        fromAddress: "owner@x.test", toAddresses: ["a@y.test"], sentAt: new Date("2026-10-13T10:00:00Z"), matchedEmail: "a@y.test", matchConfidence: "exact", bodyText: "hi",
      })
      .returning();
    await db.insert(emailMessagePerson).values({ emailMessageId: m!.id, personId: lonely!.id, matchedEmail: "a@y.test", matchConfidence: "exact" });
    const timeline = await getPersonTimeline(lonely!.id, admin.id, { viewerIsAdmin: true });
    const inline = await getAdminInlineConversations(admin, lonely!.id, []);
    assert.equal(timeline.entries.length, 0);
    assert.equal(inline.unlistedMail.length, 1);
    assert.equal(isTimelineEmpty({ entries: timeline.entries.length, upcoming: 0, unlisted: inline.unlistedMail.length }), false);
  } finally {
    await db.delete(person).where(eq(person.id, lonely!.id));
  }
});
