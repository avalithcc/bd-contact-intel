import assert from "node:assert/strict";
import { test } from "node:test";
import { runGmailReminders, type ReminderRunDeps } from "@/lib/gmail/reminderRun";
import type { ReminderRow } from "@/lib/gmail/reminderRows";
import type { DigestSendInput } from "@/lib/mailer/smtpMailer";

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
    rm_last_seen_at: daysAgo(2),
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

function fakes(over: Partial<ReminderRunDeps> = {}) {
  const sent: DigestSendInput[] = [];
  const claimed = new Set<string>();
  const marks: string[] = [];
  const deps: ReminderRunDeps = {
    send: async (m) => void sent.push(m),
    claim: async (bdId, day) => {
      const key = `${bdId}|${day}`;
      if (claimed.has(key)) return null;
      claimed.add(key);
      return `claim-${bdId}`;
    },
    markSent: async (id) => void marks.push(`sent:${id}`),
    markFailed: async (id, err) => void marks.push(`failed:${id}:${err}`),
    ...over,
  };
  return { deps, sent, marks };
}

test("a due BD gets the reminder with Reply-To set to the admin emails, and the claim is marked sent", async () => {
  const f = fakes();
  const out = await runGmailReminders({ rows: [admin, row("a")], now: NOW, siteUrl: SITE, dryRun: false }, f.deps);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0]!.to, "a@avalith.net");
  assert.deepEqual(f.sent[0]!.replyTo, ["boss@avalith.net"]);
  assert.ok(f.sent[0]!.text.includes(`${SITE}/account/email`));
  assert.deepEqual(f.marks, ["sent:claim-a"]);
  assert.deepEqual(out.summary, { sent: 1, skipped: 1, failed: 0 });
  assert.equal(out.date, "2026-10-16");
});

test("the owner is emailed on reminder #3 and on no other", async () => {
  const third = row("c", { rm_last_seen_at: daysAgo(12), rm_sent: [daysAgo(8), daysAgo(4)] });
  const second = row("b", { rm_last_seen_at: daysAgo(8), rm_sent: [daysAgo(4)] });
  const f = fakes();
  await runGmailReminders({ rows: [admin, second, third], now: NOW, siteUrl: SITE, dryRun: false }, f.deps);
  const toBd = f.sent.filter((m) => m.to !== "boss@avalith.net");
  const toOwner = f.sent.filter((m) => m.to === "boss@avalith.net");
  assert.equal(toBd.length, 2);
  assert.equal(toOwner.length, 1);
  assert.ok(toOwner[0]!.subject.includes("Name c"));
});

test("running twice the same day sends once", async () => {
  const f = fakes();
  const input = { rows: [admin, row("a")], now: NOW, siteUrl: SITE, dryRun: false };
  await runGmailReminders(input, f.deps);
  const second = await runGmailReminders(input, f.deps);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(second.results.find((r) => r.bdId === "a")?.skippedReason, "already_claimed");
});

test("a failed send is marked failed with a sanitized error, and no owner notice follows", async () => {
  const third = row("c", { rm_last_seen_at: daysAgo(12), rm_sent: [daysAgo(8), daysAgo(4)] });
  const f = fakes({
    send: async () => {
      throw new Error("AUTH failed Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
    },
  });
  const out = await runGmailReminders({ rows: [admin, third], now: NOW, siteUrl: SITE, dryRun: false }, f.deps);
  assert.equal(f.marks.length, 1);
  assert.ok(f.marks[0]!.startsWith("failed:claim-c:"));
  assert.ok(!f.marks[0]!.includes("QWxhZGRpbjpvcGVuIHNlc2FtZQ"));
  assert.deepEqual(out.summary, { sent: 0, skipped: 1, failed: 1 });
});

test("a failing owner notice does not undo the BD's reminder but is counted as a failure", async () => {
  const third = row("c", { rm_last_seen_at: daysAgo(12), rm_sent: [daysAgo(8), daysAgo(4)] });
  const f = fakes({
    send: async (m) => {
      if (m.to === "boss@avalith.net") throw new Error("smtp down");
    },
  });
  const out = await runGmailReminders({ rows: [admin, third], now: NOW, siteUrl: SITE, dryRun: false }, f.deps);
  assert.deepEqual(f.marks, ["sent:claim-c"]);
  assert.equal(out.summary.sent, 1);
  assert.equal(out.summary.failed, 1);
});

test("a dry run claims and sends nothing", async () => {
  const f = fakes();
  const out = await runGmailReminders({ rows: [admin, row("a")], now: NOW, siteUrl: SITE, dryRun: true }, f.deps);
  assert.equal(f.sent.length, 0);
  assert.deepEqual(f.marks, []);
  assert.equal(out.results.find((r) => r.bdId === "a")?.skippedReason, "dry_run");
});

test("with no admin in the table there is no Reply-To and no owner notice", async () => {
  const third = row("c", { rm_last_seen_at: daysAgo(12), rm_sent: [daysAgo(8), daysAgo(4)] });
  const f = fakes();
  await runGmailReminders({ rows: [third], now: NOW, siteUrl: SITE, dryRun: false }, f.deps);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0]!.replyTo, undefined);
});

test("when markSent throws after the mail went out the row is never marked failed; it is logged and counted as a failure", async () => {
  const f = fakes({
    markSent: async () => {
      throw new Error("db down");
    },
  });
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  let out;
  try {
    out = await runGmailReminders({ rows: [admin, row("a")], now: NOW, siteUrl: SITE, dryRun: false }, f.deps);
  } finally {
    console.error = original;
  }
  assert.equal(f.sent.length, 1, "the mail did go out");
  assert.deepEqual(f.marks, [], "the claim row is left as is, never marked failed");
  assert.deepEqual(out.summary, { sent: 0, skipped: 1, failed: 1 });
  assert.equal(out.results.find((r) => r.bdId === "a")?.skippedReason, "mark_sent_failed");
  assert.equal(logged.length, 1);
});
