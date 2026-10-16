import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isGmailUnhealthy,
  planGmailReminders,
  type ReminderCandidate,
  type ReminderDecision,
} from "@/lib/gmail/reminderPlan";

// "now" is 09:00 ART on a Friday; days below are ART days at 09:00 unless stated otherwise.
const NOW = new Date("2026-10-16T12:00:00Z");
const daysAgo = (n: number, hourUtc = 12) => new Date(Date.UTC(2026, 9, 16 - n, hourUtc, 0, 0));

function candidate(over: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    bdId: "bd-1",
    role: "bd",
    excluded: false,
    createdAt: daysAgo(60),
    lastSeenAt: daysAgo(2),
    gmailUnhealthy: true,
    sentReminders: [],
    ...over,
  };
}

function planOne(over: Partial<ReminderCandidate> = {}): ReminderDecision {
  const [d] = planGmailReminders([candidate(over)], NOW);
  return d!;
}

test("not seen for 2 days with Gmail unhealthy gets reminder #1 and no owner notice", () => {
  assert.deepEqual(planOne(), { bdId: "bd-1", action: "send", number: 1, notifyOwner: false });
});

test("seen yesterday is not yet due", () => {
  assert.deepEqual(planOne({ lastSeenAt: daysAgo(1) }), { bdId: "bd-1", action: "skip", reason: "not_due" });
});

test("the 2-day threshold counts Argentina calendar days, so a few hours of drift do not delay it", () => {
  // Seen Wednesday 20:00 ART (23:00 UTC); the run is Friday 09:00 ART: 37 hours, but two calendar days.
  assert.equal(planOne({ lastSeenAt: new Date("2026-10-14T23:00:00Z") }).action, "send");
});

test("#2 needs 3 days since #1, not 2", () => {
  assert.equal(planOne({ lastSeenAt: daysAgo(6), sentReminders: [daysAgo(2)] }).action, "skip");
  const d = planOne({ lastSeenAt: daysAgo(6), sentReminders: [daysAgo(3, 12)] });
  assert.deepEqual(d, { bdId: "bd-1", action: "send", number: 2, notifyOwner: false });
});

test("spacing survives the send time drifting by seconds between runs", () => {
  // #1 went out at 12:00:09 three days ago; this run starts at 12:00:00.
  assert.equal(planOne({ lastSeenAt: daysAgo(6), sentReminders: [new Date("2026-10-13T12:00:09Z")] }).action, "send");
});

test("#3 needs 3 days since #2 and also notifies the owner", () => {
  const sent = [daysAgo(7), daysAgo(3)];
  assert.deepEqual(planOne({ lastSeenAt: daysAgo(9), sentReminders: sent }), {
    bdId: "bd-1",
    action: "send",
    number: 3,
    notifyOwner: true,
  });
  assert.equal(planOne({ lastSeenAt: daysAgo(9), sentReminders: [daysAgo(7), daysAgo(2)] }).action, "skip");
});

test("the owner is notified on #3 only", () => {
  for (const sent of [[], [daysAgo(6)]]) {
    const d = planOne({ lastSeenAt: daysAgo(9), sentReminders: sent });
    assert.equal(d.action === "send" && d.notifyOwner, false);
  }
});

test("never more than 3 in a series", () => {
  const d = planOne({ lastSeenAt: daysAgo(30), sentReminders: [daysAgo(20), daysAgo(15), daysAgo(10)] });
  assert.deepEqual(d, { bdId: "bd-1", action: "skip", reason: "series_complete" });
});

test("coming back ends the series: reminders sent before the last visit do not count", () => {
  // Three reminders went out, then the BD was seen again 2 days ago and is still disconnected: a fresh series, #1.
  const d = planOne({ lastSeenAt: daysAgo(2), sentReminders: [daysAgo(20), daysAgo(15), daysAgo(10)] });
  assert.deepEqual(d, { bdId: "bd-1", action: "send", number: 1, notifyOwner: false });
});

test("a reminder sent after the last visit counts, one sent before it does not", () => {
  const d = planOne({ lastSeenAt: daysAgo(6), sentReminders: [daysAgo(20), daysAgo(3)] });
  assert.deepEqual(d, { bdId: "bd-1", action: "send", number: 2, notifyOwner: false });
});

test("healthy Gmail stops the series", () => {
  assert.deepEqual(planOne({ gmailUnhealthy: false }), { bdId: "bd-1", action: "skip", reason: "gmail_healthy" });
});

test("admins are never reminded", () => {
  assert.deepEqual(planOne({ role: "admin" }), { bdId: "bd-1", action: "skip", reason: "admin" });
});

test("an excluded account is never reminded", () => {
  assert.deepEqual(planOne({ excluded: true }), { bdId: "bd-1", action: "skip", reason: "excluded" });
});

test("a BD that was never seen counts from created_at", () => {
  assert.equal(planOne({ lastSeenAt: null, createdAt: daysAgo(2) }).action, "send");
  assert.deepEqual(planOne({ lastSeenAt: null, createdAt: daysAgo(1) }), { bdId: "bd-1", action: "skip", reason: "not_due" });
});

test("the order of sentReminders does not matter", () => {
  const a = planOne({ lastSeenAt: daysAgo(9), sentReminders: [daysAgo(7), daysAgo(3)] });
  const b = planOne({ lastSeenAt: daysAgo(9), sentReminders: [daysAgo(3), daysAgo(7)] });
  assert.deepEqual(a, b);
});

test("planning twice with the same input gives the same result and leaves the input untouched", () => {
  const input = [
    candidate({ bdId: "a", lastSeenAt: daysAgo(9), sentReminders: [daysAgo(3), daysAgo(7)] }),
    candidate({ bdId: "b", role: "admin" }),
  ];
  const snapshot = structuredClone(input);
  const first = planGmailReminders(input, NOW);
  const second = planGmailReminders(input, NOW);
  assert.deepEqual(first, second);
  assert.deepEqual(input, snapshot);
});

test("one decision per candidate, in the same order", () => {
  const out = planGmailReminders([candidate({ bdId: "x" }), candidate({ bdId: "y", role: "admin" })], NOW);
  assert.deepEqual(out.map((d) => d.bdId), ["x", "y"]);
});

test("isGmailUnhealthy is exactly the red banner: disconnected, expired/revoked and missing scope are in; amber and healthy are out", () => {
  const ok = {
    status: "connected",
    grantedScopes: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
    syncError: null,
    lastSyncedAt: new Date(NOW.getTime() - 60_000),
    connectedAt: daysAgo(30),
  };
  assert.equal(isGmailUnhealthy(null, NOW), true, "never connected");
  assert.equal(isGmailUnhealthy({ ...ok, status: "revoked" }, NOW), true);
  assert.equal(isGmailUnhealthy({ ...ok, status: "error" }, NOW), true);
  assert.equal(isGmailUnhealthy({ ...ok, status: "disconnected" }, NOW), true);
  assert.equal(isGmailUnhealthy({ ...ok, grantedScopes: "https://www.googleapis.com/auth/gmail.send" }, NOW), true);
  assert.equal(isGmailUnhealthy(ok, NOW), false);
});
