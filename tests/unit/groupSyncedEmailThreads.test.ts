/**
 * Unit tests for src/lib/gmail/groupSyncedEmailThreads.ts (admin-conversation-
 * access mockup, "Correos sincronizados" section — closes the README-flagged
 * gap where the admin conversation page never rendered `syncedEmails`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupSyncedEmailThreads } from "@/lib/gmail/groupSyncedEmailThreads";
import type { AdminSyncedEmailMessage } from "@/lib/activity/getConversationForAdmin";

function msg(overrides: Partial<AdminSyncedEmailMessage>): AdminSyncedEmailMessage {
  return {
    id: "m1",
    direction: "outbound",
    gmailThreadId: "t1",
    fromAddress: "bd@avalith.com",
    toAddresses: ["contact@acme.com"],
    ccAddresses: [],
    subject: "Hello",
    bodyText: "body",
    bodyTruncated: false,
    sentAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

test("groups messages sharing a gmailThreadId into one thread, sorted oldest-first within it", () => {
  const older = msg({ id: "a", sentAt: new Date("2026-10-01T00:00:00Z") });
  const newer = msg({ id: "b", sentAt: new Date("2026-10-02T00:00:00Z"), direction: "inbound" });
  const groups = groupSyncedEmailThreads([newer, older]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].messages.map((m) => m.id),
    ["a", "b"],
  );
});

test("orders threads by their latest message, most recent thread first", () => {
  const t1 = msg({ id: "a", gmailThreadId: "t1", sentAt: new Date("2026-10-01T00:00:00Z") });
  const t2 = msg({ id: "b", gmailThreadId: "t2", sentAt: new Date("2026-10-05T00:00:00Z") });
  const groups = groupSyncedEmailThreads([t1, t2]);
  assert.deepEqual(
    groups.map((g) => g.threadId),
    ["t2", "t1"],
  );
});

test("subject is the oldest message's subject in the thread", () => {
  const older = msg({ id: "a", subject: "Original subject", sentAt: new Date("2026-10-01T00:00:00Z") });
  const newer = msg({ id: "b", subject: "Re: Original subject", sentAt: new Date("2026-10-02T00:00:00Z") });
  const groups = groupSyncedEmailThreads([newer, older]);
  assert.equal(groups[0].subject, "Original subject");
});

test("falls back to the next message's subject when the oldest has none", () => {
  const older = msg({ id: "a", subject: null, sentAt: new Date("2026-10-01T00:00:00Z") });
  const newer = msg({ id: "b", subject: "Has a subject", sentAt: new Date("2026-10-02T00:00:00Z") });
  const groups = groupSyncedEmailThreads([older, newer]);
  assert.equal(groups[0].subject, "Has a subject");
});

test("two different gmailThreadIds produce two separate groups even with one message each", () => {
  const a = msg({ id: "a", gmailThreadId: "t1" });
  const b = msg({ id: "b", gmailThreadId: "t2", sentAt: new Date("2026-10-03T00:00:00Z") });
  const groups = groupSyncedEmailThreads([a, b]);
  assert.equal(groups.length, 2);
});

test("empty input yields no groups", () => {
  assert.deepEqual(groupSyncedEmailThreads([]), []);
});
