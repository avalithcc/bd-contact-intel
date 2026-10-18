import assert from "node:assert/strict";
import { test } from "node:test";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { sendManualReminder, type ManualReminderAudit, type ManualReminderDeps } from "@/lib/gmail/manualReminder";
import { runGmailReminders, type ReminderRunDeps } from "@/lib/gmail/reminderRun";
import type { ReminderRow } from "@/lib/gmail/reminderRows";
import type { DigestSendInput } from "@/lib/mailer/smtpMailer";

// 09:00 ART on a Friday.
const NOW = new Date("2026-10-16T12:00:00Z");
const SITE = "https://bd-contact-intel.vercel.app";
const daysAgo = (n: number) => new Date(Date.UTC(2026, 9, 16 - n, 12, 0, 0)).toISOString();

function row(id: string, over: Partial<ReminderRow> = {}): ReminderRow {
  return {
    rm_bd_id: id,
    rm_name: `Name ${id}`,
    rm_email: `${id}@avalith.net`,
    rm_role: "bd",
    rm_reminders_enabled: true,
    rm_created_at: daysAgo(60),
    rm_last_seen_at: daysAgo(0),
    rm_has_account: false,
    rm_status: null,
    rm_scopes: null,
    rm_sync_error: null,
    rm_last_synced_at: null,
    rm_connected_at: null,
    rm_sent: [],
    ...over,
  };
}
const admin = row("boss", { rm_role: "admin" });

function runFakes() {
  const sent: DigestSendInput[] = [];
  const deps: ReminderRunDeps = {
    send: async (m) => void sent.push(m),
    claim: async (bdId) => `claim-${bdId}`,
    markSent: async () => undefined,
    markFailed: async () => undefined,
  };
  return { deps, sent };
}

test("runGmailReminders with onlyBdId sends the next reminder now to that BD alone, ignoring the schedule", async () => {
  const f = runFakes();
  const out = await runGmailReminders({ rows: [admin, row("a"), row("b")], now: NOW, siteUrl: SITE, dryRun: false, onlyBdId: "a" }, f.deps);
  assert.equal(f.sent.length, 1, "seen today would not be due for the cron");
  assert.equal(f.sent[0]!.to, "a@avalith.net");
  assert.deepEqual(f.sent[0]!.replyTo, ["boss@avalith.net"]);
  assert.deepEqual(out.results.map((r) => [r.bdId, r.sent, r.number]), [["a", true, 1]]);
});

test("onlyBdId counts in the series: with two sent, the manual one is #3 and the owner is told", async () => {
  const f = runFakes();
  const sentAt = [daysAgo(7), daysAgo(4)];
  const out = await runGmailReminders({ rows: [admin, row("a", { rm_last_seen_at: daysAgo(10), rm_sent: sentAt })], now: NOW, siteUrl: SITE, dryRun: false, onlyBdId: "a" }, f.deps);
  assert.equal(out.results.find((r) => r.bdId === "a")!.number, 3);
  assert.deepEqual(f.sent.map((m) => m.to), ["a@avalith.net", "boss@avalith.net"]);
});

test("onlyBdId still refuses a healthy BD", async () => {
  const f = runFakes();
  const healthy = row("a", { rm_has_account: true, rm_status: "connected", rm_scopes: "https://www.googleapis.com/auth/gmail.readonly", rm_last_synced_at: new Date(NOW.getTime() - 60_000).toISOString() });
  const out = await runGmailReminders({ rows: [admin, healthy], now: NOW, siteUrl: SITE, dryRun: false, onlyBdId: "a" }, f.deps);
  assert.equal(f.sent.length, 0);
  assert.deepEqual(out.results.map((r) => r.skippedReason), ["gmail_healthy"]);
});

function manualFakes(rows: ReminderRow[], over: Partial<ManualReminderDeps> = {}) {
  const sent: DigestSendInput[] = [];
  const audits: ManualReminderAudit[] = [];
  const marks: string[] = [];
  const deps: ManualReminderDeps = {
    readRows: async () => rows,
    send: async (m) => void sent.push(m),
    claim: async (bdId) => `claim-${bdId}`,
    markSentAudited: async (claimId, audit) => {
      marks.push(`sent:${claimId}`);
      audits.push(audit);
    },
    markFailed: async (claimId, err) => void marks.push(`failed:${claimId}:${err}`),
    ...over,
  };
  return { deps, sent, audits, marks };
}
const ADMIN = { id: "boss", role: "admin" };

test("a manual send mails the BD and records the audit with the admin as actor in the same step that marks it sent", async () => {
  const f = manualFakes([admin, row("a")]);
  const r = await sendManualReminder({ admin: ADMIN, bdId: "a", now: NOW, siteUrl: SITE }, f.deps);
  assert.deepEqual(r, { ok: true, number: 1 });
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.audits, [{ actorBdId: "boss", bdId: "a", number: 1, sentOn: "2026-10-16" }]);
  assert.deepEqual(f.marks, ["sent:claim-a"]);
});

test("a BD that is not an admin cannot send one", async () => {
  const f = manualFakes([admin, row("a")]);
  await assert.rejects(() => sendManualReminder({ admin: { id: "a", role: "bd" }, bdId: "a", now: NOW, siteUrl: SITE }, f.deps), AdminRequiredError);
  assert.equal(f.sent.length, 0);
});

test("an unknown BD, an ineligible BD and a day already claimed each say why and send and audit nothing", async () => {
  const f = manualFakes([admin, row("a")]);
  assert.deepEqual(await sendManualReminder({ admin: ADMIN, bdId: "zz", now: NOW, siteUrl: SITE }, f.deps), { ok: false, reason: "not_found" });
  assert.deepEqual(await sendManualReminder({ admin: ADMIN, bdId: "boss", now: NOW, siteUrl: SITE }, f.deps), { ok: false, reason: "not_eligible" });
  const claimed = manualFakes([admin, row("a")], { claim: async () => null });
  assert.deepEqual(await sendManualReminder({ admin: ADMIN, bdId: "a", now: NOW, siteUrl: SITE }, claimed.deps), { ok: false, reason: "already_sent_today" });
  assert.deepEqual([f.sent.length, f.audits.length, claimed.sent.length, claimed.audits.length], [0, 0, 0, 0]);
});

test("a failed send is marked failed, reported, and never audited", async () => {
  const f = manualFakes([admin, row("a")], {
    send: async () => {
      throw new Error("smtp down");
    },
  });
  const r = await sendManualReminder({ admin: ADMIN, bdId: "a", now: NOW, siteUrl: SITE }, f.deps);
  assert.deepEqual(r, { ok: false, reason: "send_failed" });
  assert.equal(f.audits.length, 0);
  assert.equal(f.marks.length, 1);
  assert.match(f.marks[0]!, /^failed:claim-a:/);
});
