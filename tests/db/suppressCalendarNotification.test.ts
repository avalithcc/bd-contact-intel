/**
 * scripts/suppress-calendar-notification.ts's DB layer against a scratch database: opt-in and fail-closed
 * (`npm run test:db`, DATABASE_URL a local `_e2e` database). Seeds one syncing BD, the calendar person with
 * activities and linked mail, runs dry run then execute, and removes everything it created (per-run token).
 * Skipped when the scratch database already holds a real calendar-notification person, so it never deletes one.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const ADDRESS = "calendar-notification@google.com";
const bdIds: string[] = [];
const messageIds: string[] = [];

after(async () => {
  const { db } = await import("@/db");
  const { bd, emailMessage } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (messageIds.length) await db.delete(emailMessage).where(inArray(emailMessage.id, messageIds));
  if (bdIds.length) await db.delete(bd).where(inArray(bd.id, bdIds)); // cascades account, never-log rules, audit rows
});

test("dry run measures, execute adds the rule per syncing BD and removes the person but keeps the mail, a re-run refuses", async () => {
  const { db } = await import("@/db");
  const { activity, auditLog, bd, emailAccount, emailMessage, emailMessagePerson, emailNeverLog, person } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { dryRunSuppress, executeSuppress } = await import("@/lib/calendarNotification/db");

  const [existing] = await db.select({ id: person.id }).from(person).where(eq(person.emailNormalized, ADDRESS));
  assert.equal(existing, undefined, "scratch database already holds the calendar person; refusing to touch it");

  const [b] = await db.insert(bd).values({ name: `Cal ${run}`, email: `zz-cal-${run}@example.test` }).returning();
  bdIds.push(b!.id);
  await db.insert(emailAccount).values({ bdId: b!.id, emailAddress: `acct-${run}@example.test`, status: "connected", refreshTokenEncrypted: "x", grantedScopes: "https://www.googleapis.com/auth/gmail.readonly", historyId: "1" });
  const [p] = await db.insert(person).values({ firstName: "Calendar", lastName: "Notification", email: ADDRESS, emailNormalized: ADDRESS }).returning();
  await db.insert(activity).values([{ type: "reply_received", personId: p!.id }, { type: "reply_received", personId: p!.id }]);
  for (let i = 0; i < 3; i++) {
    const [m] = await db.insert(emailMessage).values({ bdId: b!.id, gmailMessageId: `${run}-${i}`, gmailThreadId: `${run}-t${i}`, direction: "inbound", fromAddress: ADDRESS, sentAt: new Date(), personId: p!.id, matchedEmail: ADDRESS, matchConfidence: "exact" }).returning();
    messageIds.push(m!.id);
    await db.insert(emailMessagePerson).values({ emailMessageId: m!.id, personId: p!.id, matchedEmail: ADDRESS, matchConfidence: "exact" });
  }

  const dry = await dryRunSuppress();
  assert.equal(dry.kind, "ok");
  if (dry.kind !== "ok") return;
  assert.ok(dry.addRuleBdIds.includes(b!.id));
  assert.equal(dry.blast.activities, 2);
  assert.equal(dry.blast.emailMessagePersonRows, 3);
  assert.equal(dry.blast.survivingEmailMessages, 3);
  const [stillThere] = await db.select({ id: person.id }).from(person).where(eq(person.id, p!.id));
  assert.ok(stillThere, "a dry run writes nothing");

  const { plan, auditLogId } = await executeSuppress(b!.id);
  assert.equal(plan.kind, "ok");
  assert.ok(auditLogId);

  const [gone] = await db.select({ id: person.id }).from(person).where(eq(person.id, p!.id));
  assert.equal(gone, undefined);
  assert.equal((await db.select().from(activity).where(eq(activity.personId, p!.id))).length, 0);
  assert.equal((await db.select().from(emailMessagePerson).where(eq(emailMessagePerson.personId, p!.id))).length, 0);
  const kept = await db.select().from(emailMessage).where(eq(emailMessage.bdId, b!.id));
  assert.equal(kept.length, 3);
  assert.ok(kept.every((m) => m.personId === null));
  const rules = await db.select().from(emailNeverLog).where(and(eq(emailNeverLog.bdId, b!.id), eq(emailNeverLog.kind, "address"), eq(emailNeverLog.value, ADDRESS)));
  assert.equal(rules.length, 1);
  const [audit] = await db.select().from(auditLog).where(eq(auditLog.id, auditLogId!));
  assert.equal(audit!.action, "suppress_calendar_notification");

  const again = await executeSuppress(b!.id);
  assert.equal(again.plan.kind, "refuse");
  assert.equal(again.auditLogId, null);
  assert.equal((await db.select().from(emailNeverLog).where(and(eq(emailNeverLog.bdId, b!.id), eq(emailNeverLog.value, ADDRESS)))).length, 1);
});
