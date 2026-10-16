import assert from "node:assert/strict";
import { test } from "node:test";
import { planGmailReminders } from "@/lib/gmail/reminderPlan";
import { rowToCandidate, type ReminderRow } from "@/lib/gmail/reminderRows";

const NOW = new Date("2026-10-16T12:00:00Z");

function row(over: Partial<ReminderRow> = {}): ReminderRow {
  return {
    rm_bd_id: "bd-1",
    rm_name: "Joaquín Rivas",
    rm_email: "joaquin@avalith.net",
    rm_role: "bd",
    rm_created_at: "2026-08-01T10:00:00.000Z",
    rm_last_seen_at: "2026-10-14T10:00:00.000Z",
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

test("raw string timestamps become Dates and a BD with no email_account row is unhealthy", () => {
  const c = rowToCandidate(row({ rm_sent: ["2026-10-10T12:00:00.000Z"] }), NOW);
  assert.ok(c.createdAt instanceof Date);
  assert.ok(c.lastSeenAt instanceof Date);
  assert.ok(c.sentReminders[0] instanceof Date);
  assert.equal(c.gmailUnhealthy, true);
});

test("a null last_seen_at stays null so the planner falls back to created_at", () => {
  assert.equal(rowToCandidate(row({ rm_last_seen_at: null }), NOW).lastSeenAt, null);
});

test("a connected account with the read scope and a fresh sync is healthy", () => {
  const c = rowToCandidate(
    row({
      rm_has_account: true,
      rm_status: "connected",
      rm_scopes: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
      rm_last_synced_at: new Date(NOW.getTime() - 60_000),
      rm_connected_at: "2026-09-01T10:00:00.000Z",
    }),
    NOW,
  );
  assert.equal(c.gmailUnhealthy, false);
});

test("a mapped row feeds the planner end to end", () => {
  const [d] = planGmailReminders([rowToCandidate(row({ rm_last_seen_at: "2026-10-13T10:00:00.000Z" }), NOW)], NOW);
  assert.deepEqual(d, { bdId: "bd-1", action: "send", number: 1, notifyOwner: false });
});
