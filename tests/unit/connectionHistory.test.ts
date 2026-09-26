/**
 * Unit tests for src/lib/contacts/connectionHistory.ts (task 11.1/11.2;
 * contact-record spec "Associations" — connected BDs each with connectedOn
 * and a message summary; admin-access-audit spec "Non-admins ... MAY see
 * which BDs have history ... never the content"). Pure, no DB — the summary
 * carries counts/dates only, never message content.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeConnectionHistory } from "@/lib/contacts/connectionHistory";

test("no messages yet returns a 'none' summary", () => {
  const result = describeConnectionHistory({ messageCount: 0, lastMessageAt: null });
  assert.deepEqual(result, { kind: "none" });
});

test("messages present returns count and last message date, never content", () => {
  const lastMessageAt = new Date("2026-10-12T18:04:00Z");
  const result = describeConnectionHistory({ messageCount: 6, lastMessageAt });
  assert.deepEqual(result, { kind: "some", count: 6, lastMessageAt });
});

test("a positive count with a null date still reports 'some' (defensive)", () => {
  const result = describeConnectionHistory({ messageCount: 2, lastMessageAt: null });
  assert.deepEqual(result, { kind: "some", count: 2, lastMessageAt: null });
});
