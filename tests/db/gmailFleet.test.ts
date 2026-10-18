/**
 * getGmailFleetHealth (admin "Estado de Gmail") against a scratch database with migration 0051 applied. Opt-in and fail-closed:
 * `npm run test:db`, DATABASE_URL a local `_e2e` database. Never calls Gmail. Everything is created under a per-run token and
 * removed.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const bdIds: string[] = [];
const personIds: string[] = [];
const NOW = new Date();
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

async function mkBd(name: string, over: Record<string, unknown> = {}) {
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: `${name} ${run}`, email: `zz-${name.toLowerCase()}-${run}@example.test`, ...over }).returning();
  bdIds.push(b.id);
  return b;
}
async function mkAccount(bdId: string, over: Record<string, unknown> = {}) {
  const { db } = await import("@/db");
  const { emailAccount } = await import("@/db/schema");
  await db.insert(emailAccount).values({ bdId, emailAddress: `acct-${bdId.slice(0, 6)}@example.test`, status: "connected", grantedScopes: "https://www.googleapis.com/auth/gmail.readonly", lastSyncedAt: minutesAgo(2), historyId: "123", ...over });
}
async function mkMessage(bdId: string, sentAt: Date, direction: "inbound" | "outbound") {
  const { db } = await import("@/db");
  const { emailMessage } = await import("@/db/schema");
  await db.insert(emailMessage).values({ bdId, gmailMessageId: randomUUID(), gmailThreadId: randomUUID(), direction, fromAddress: "a@example.test", sentAt, matchedEmail: "a@example.test", matchConfidence: "exact" });
}
async function mkBounce(actorBdId: string, severity: "hard" | "soft", createdAt: Date) {
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  await db.insert(activity).values({ type: "email_bounced", actorBdId, metadata: { severity }, createdAt });
}
async function mkScheduled(bdId: string, personId: string, status: string, error: string | null, updatedAt: Date) {
  const { db } = await import("@/db");
  const { scheduledEmail } = await import("@/db/schema");
  await db.insert(scheduledEmail).values({ bdId, personId, toAddress: "x@prospect.test", subject: "Hola", body: "Texto", sendAt: daysAgo(1), status, error, updatedAt });
}
async function mkPerson(label: string) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const [p] = await db.insert(person).values({ firstName: label, lastName: run, email: `${label}-${run}@prospect.test` }).returning();
  personIds.push(p.id);
  return p;
}

after(async () => {
  const { db } = await import("@/db");
  const { bd, person, activity } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (bdIds.length) {
    await db.delete(activity).where(inArray(activity.actorBdId, bdIds));
    await db.delete(bd).where(inArray(bd.id, bdIds)); // cascades the account, messages, reminders and scheduled emails
  }
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
});

test("one read returns every monitored BD with its Gmail account, newest email, bounces, failed sends and reminders", async () => {
  const { getGmailFleetHealth } = await import("@/lib/gmail/fleetQueries");
  const { db } = await import("@/db");
  const { gmailReminderSend } = await import("@/db/schema");

  const ok = await mkBd("Ok");
  await mkAccount(ok.id);
  await mkMessage(ok.id, minutesAgo(600), "outbound");
  await mkMessage(ok.id, minutesAgo(13), "inbound");
  await mkMessage(ok.id, minutesAgo(300), "outbound");
  await mkBounce(ok.id, "hard", daysAgo(1));
  await mkBounce(ok.id, "soft", daysAgo(2));
  await mkBounce(ok.id, "soft", daysAgo(3));
  await mkBounce(ok.id, "hard", daysAgo(40)); // outside the 30-day window

  const failing = await mkBd("Failing");
  await mkAccount(failing.id, { syncError: "Gmail API returned 503", lastSyncedAt: minutesAgo(151) });
  const p = await mkPerson("fleet");
  await mkScheduled(failing.id, p.id, "failed", "gmail_send_old", daysAgo(3));
  await mkScheduled(failing.id, p.id, "failed", "gmail_send_failed", daysAgo(1));
  await mkScheduled(failing.id, p.id, "scheduled", null, daysAgo(1)); // not failed: not counted

  const never = await mkBd("Never");
  await db.insert(gmailReminderSend).values({ bdId: never.id, sentOn: "2026-10-01", reminderNumber: 1, status: "sent", sentAt: daysAgo(10) });
  await db.insert(gmailReminderSend).values({ bdId: never.id, sentOn: "2026-10-02", reminderNumber: 2, status: "failed", error: "x" });

  const admin = await mkBd("Admin", { role: "admin" });
  const ignored = await mkBd("Ignored", { emailRemindersEnabled: false });

  const rows = await getGmailFleetHealth(NOW);
  const by = new Map(rows.map((r) => [r.bdId, r]));

  assert.equal(by.has(ignored.id), false, "a non-admin with reminders off and no account is not monitored");
  assert.equal(by.has(admin.id), true, "an admin appears even without an account");

  const o = by.get(ok.id)!;
  assert.equal(o.connection, "connected");
  assert.equal(o.lastEmail?.direction, "inbound");
  assert.ok(o.lastEmail && Math.abs(o.lastEmail.at.getTime() - minutesAgo(13).getTime()) < 1000);
  assert.deepEqual([o.bouncesHard, o.bouncesSoft], [1, 2]);
  assert.equal(o.account?.hasCursor, true);
  assert.equal(o.failedSends, 0);
  assert.ok(o.createdAt instanceof Date);

  const f = by.get(failing.id)!;
  assert.deepEqual([f.connection, f.sync.state, f.sync.errorKind], ["connected", "failing", "other"]);
  assert.deepEqual([f.failedSends, f.lastFailedError], [2, "gmail_send_failed"]);
  assert.equal(f.lastEmail, null);

  const n = by.get(never.id)!;
  assert.equal(n.connection, "never");
  assert.equal(n.account, null);
  assert.equal(n.sentReminders.length, 1, "only `sent` reminders count");
  assert.ok(n.sentReminders[0] instanceof Date);
  assert.equal(n.canSendReminder, true);
  assert.equal(by.get(admin.id)!.reminder.kind, "admin");

  const names = rows.map((r) => r.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "es")), "sorted by name");
});

test("bounces are attributed to the BD that synced them, not to anyone else", async () => {
  const { getGmailFleetHealth } = await import("@/lib/gmail/fleetQueries");
  const a = await mkBd("BounceA");
  const b = await mkBd("BounceB");
  await mkAccount(a.id);
  await mkAccount(b.id);
  await mkBounce(a.id, "hard", daysAgo(2));
  const rows = await getGmailFleetHealth(NOW);
  assert.deepEqual([rows.find((r) => r.bdId === a.id)!.bouncesHard, rows.find((r) => r.bdId === b.id)!.bouncesHard], [1, 0]);
});

test("a manual reminder claims the day, marks it sent and writes the audit row in one step; it counts in the fleet series and a second one the same day is refused", async () => {
  const { sendManualReminder } = await import("@/lib/gmail/manualReminder");
  const q = await import("@/lib/gmail/reminderQueries");
  const { getGmailFleetHealth } = await import("@/lib/gmail/fleetQueries");
  const { db } = await import("@/db");
  const { auditLog } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");

  const adm = await mkBd("ManualAdmin", { role: "admin" });
  const target = await mkBd("ManualTarget");
  const mails: { to: string }[] = [];
  const deps = {
    readRows: () => q.getReminderRows(),
    send: async (m: { to: string }) => void mails.push(m),
    claim: q.claimGmailReminder,
    markSentAudited: (id: string, audit: Parameters<typeof q.markGmailReminderSentAudited>[1]) => q.markGmailReminderSentAudited(id, audit),
    markFailed: q.markGmailReminderFailed,
  };
  const auditRows = () => db.select().from(auditLog).where(and(eq(auditLog.actorBdId, adm.id), eq(auditLog.targetBdId, target.id)));

  const first = await sendManualReminder({ admin: adm, bdId: target.id, now: NOW, siteUrl: "https://crm.example.test" }, deps);
  assert.deepEqual(first, { ok: true, number: 1 });
  assert.deepEqual(mails.map((m) => m.to), [target.email]);

  const audits = await auditRows();
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, "gmail_reminder_manual");
  assert.equal((audits[0]!.metadata as { reminderNumber: number }).reminderNumber, 1);

  const row = (await getGmailFleetHealth(NOW)).find((r) => r.bdId === target.id)!;
  assert.equal(row.sentReminders.length, 1, "the manual one is a `sent` reminder of the series");
  assert.equal(row.reminder.kind === "series" && row.reminder.sent, 1);

  const again = await sendManualReminder({ admin: adm, bdId: target.id, now: NOW, siteUrl: "https://crm.example.test" }, deps);
  assert.deepEqual(again, { ok: false, reason: "already_sent_today" });
  assert.equal(mails.length, 1);
  assert.equal((await auditRows()).length, 1);
});

test("the admin sidebar pill counts exactly the BDs the fleet screen lists under 'Necesitan atención', and a BD never pays for it", async () => {
  const { getAppShellBadgeCounts } = await import("@/lib/shell/appShellBadgeCounts");
  const { getGmailFleetHealth } = await import("@/lib/gmail/fleetQueries");
  const { summarizeFleet } = await import("@/lib/gmail/fleetView");

  const adm = await mkBd("PillAdmin", { role: "admin" });
  const plain = await mkBd("PillBd");
  const sick = await mkBd("PillSick");
  await mkAccount(sick.id, { grantedScopes: "https://www.googleapis.com/auth/gmail.send" });

  const asAdmin = await getAppShellBadgeCounts(adm.id, NOW, true);
  const asBd = await getAppShellBadgeCounts(plain.id, NOW, false);
  const summary = summarizeFleet(await getGmailFleetHealth(NOW));
  assert.ok(summary.attention >= 2, "the admin without an account and the BD that must reconnect both need attention");
  assert.equal(asAdmin.gmailAttentionCount, summary.attention);
  assert.equal(asBd.gmailAttentionCount, 0);
});

test("a manual reminder whose send failed can be retried the same day; a sent or in-flight claim still blocks", async () => {
  const { sendManualReminder } = await import("@/lib/gmail/manualReminder");
  const q = await import("@/lib/gmail/reminderQueries");
  const { db } = await import("@/db");
  const { auditLog, gmailReminderSend } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");

  const adm = await mkBd("RetryAdmin", { role: "admin" });
  const target = await mkBd("RetryTarget");
  let smtpDown = true;
  const mails: string[] = [];
  const deps = {
    readRows: () => q.getReminderRows(),
    send: async (m: { to: string }) => {
      if (smtpDown) throw new Error("smtp down");
      mails.push(m.to);
    },
    claim: q.claimGmailReminderManual,
    markSentAudited: (id: string, audit: Parameters<typeof q.markGmailReminderSentAudited>[1]) => q.markGmailReminderSentAudited(id, audit),
    markFailed: q.markGmailReminderFailed,
  };
  const input = { admin: adm, bdId: target.id, now: NOW, siteUrl: "https://crm.example.test" };

  assert.deepEqual(await sendManualReminder(input, deps), { ok: false, reason: "send_failed" });
  const [failedRow] = await db.select().from(gmailReminderSend).where(eq(gmailReminderSend.bdId, target.id));
  assert.equal(failedRow!.status, "failed");

  smtpDown = false;
  assert.deepEqual(await sendManualReminder(input, deps), { ok: true, number: 1 });
  const rows = await db.select().from(gmailReminderSend).where(eq(gmailReminderSend.bdId, target.id));
  assert.deepEqual(rows.map((r) => [r.status, r.error]), [["sent", null]], "the same day row was reclaimed, not duplicated");
  assert.equal((await db.select().from(auditLog).where(and(eq(auditLog.actorBdId, adm.id), eq(auditLog.targetBdId, target.id)))).length, 1);
  assert.deepEqual(await sendManualReminder(input, deps), { ok: false, reason: "already_sent_today" });
  assert.equal(mails.length, 1);
});
