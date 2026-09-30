import assert from "node:assert/strict";
import { test } from "node:test";
import { sortMessagesChronologically } from "@/lib/activity/conversationMessageOrder";

test("sortMessagesChronologically: reorders a reverse-chronological input to oldest-first", () => {
  const messages = [
    { id: "b", sentAt: new Date("2026-09-02T00:00:00Z") },
    { id: "a", sentAt: new Date("2026-09-01T00:00:00Z") },
    { id: "c", sentAt: new Date("2026-09-03T00:00:00Z") },
  ];
  const sorted = sortMessagesChronologically(messages);
  assert.deepEqual(
    sorted.map((m) => m.id),
    ["a", "b", "c"],
  );
});

test("sortMessagesChronologically: does not mutate the input array", () => {
  const messages = [
    { id: "b", sentAt: new Date("2026-09-02T00:00:00Z") },
    { id: "a", sentAt: new Date("2026-09-01T00:00:00Z") },
  ];
  const originalOrder = messages.map((m) => m.id);
  sortMessagesChronologically(messages);
  assert.deepEqual(
    messages.map((m) => m.id),
    originalOrder,
  );
});

test("sortMessagesChronologically: an already-ascending input is left in the same order", () => {
  const messages = [
    { id: "a", sentAt: new Date("2026-09-01T00:00:00Z") },
    { id: "b", sentAt: new Date("2026-09-02T00:00:00Z") },
  ];
  assert.deepEqual(
    sortMessagesChronologically(messages).map((m) => m.id),
    ["a", "b"],
  );
});

test("sortMessagesChronologically: empty input returns empty output", () => {
  assert.deepEqual(sortMessagesChronologically([]), []);
});
