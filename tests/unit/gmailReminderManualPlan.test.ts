import assert from "node:assert/strict";
import { test } from "node:test";
import { planManualReminder, reminderDueOn, type ReminderCandidate } from "@/lib/gmail/reminderPlan";

// 09:00 ART on a Friday.
const NOW = new Date("2026-10-16T12:00:00Z");
const daysAgo = (n: number) => new Date(Date.UTC(2026, 9, 16 - n, 12, 0, 0));

function candidate(over: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return { bdId: "bd-1", role: "bd", excluded: false, createdAt: daysAgo(60), lastSeenAt: daysAgo(0), gmailUnhealthy: true, sentReminders: [], ...over };
}

test("a manual send ignores the schedule: seen today with no reminder yet is reminder #1", () => {
  assert.deepEqual(planManualReminder(candidate(), NOW), { bdId: "bd-1", action: "send", number: 1, notifyOwner: false });
});

test("a manual send right after #1 is #2, and it counts in the series", () => {
  assert.deepEqual(planManualReminder(candidate({ lastSeenAt: daysAgo(5), sentReminders: [daysAgo(0)] }), NOW), {
    bdId: "bd-1",
    action: "send",
    number: 2,
    notifyOwner: false,
  });
});

test("the third reminder still asks for the owner notice", () => {
  const sent = [daysAgo(9), daysAgo(6)];
  assert.deepEqual(planManualReminder(candidate({ lastSeenAt: daysAgo(12), sentReminders: sent }), NOW), {
    bdId: "bd-1",
    action: "send",
    number: 3,
    notifyOwner: true,
  });
});

test("a manual send keeps every other guard: admin, excluded, healthy Gmail and a complete series", () => {
  const reason = (over: Partial<ReminderCandidate>) => {
    const d = planManualReminder(candidate(over), NOW);
    return d.action === "skip" ? d.reason : "send";
  };
  assert.equal(reason({ role: "admin" }), "admin");
  assert.equal(reason({ excluded: true }), "excluded");
  assert.equal(reason({ gmailUnhealthy: false }), "gmail_healthy");
  assert.equal(reason({ lastSeenAt: daysAgo(20), sentReminders: [daysAgo(12), daysAgo(9), daysAgo(6)] }), "series_complete");
});

test("reminderDueOn returns the Nth business day after the base date (Argentina calendar)", () => {
  // Friday 16 Oct 2026 + 2 business days = Tuesday 20 Oct; + 3 = Wednesday 21 Oct.
  assert.equal(reminderDueOn(NOW, 2), "2026-10-20");
  assert.equal(reminderDueOn(NOW, 3), "2026-10-21");
  // Monday 12 Oct + 2 = Wednesday 14 Oct.
  assert.equal(reminderDueOn(new Date("2026-10-12T15:00:00Z"), 2), "2026-10-14");
});

test("reminderDueOn agrees with the planner: due exactly on the returned day, not before", () => {
  const seen = new Date("2026-10-16T15:00:00Z");
  const due = reminderDueOn(seen, 2);
  const noon = (ymd: string) => new Date(`${ymd}T15:00:00Z`);
  assert.equal(planManualReminder(candidate({ lastSeenAt: seen }), noon(due)).action, "send");
});
