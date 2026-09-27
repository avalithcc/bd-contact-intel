import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildConnectionTimelineEntries,
  linkedinEntryAccess,
} from "@/lib/contacts/connectionTimelineEntries";

test("a connection with no messages at all produces no entry", () => {
  const result = buildConnectionTimelineEntries([
    { bdId: "bd-1", bdName: "Ana", sentCount: 0, receivedCount: 0, lastMessageAt: null },
  ]);
  assert.deepEqual(result, []);
});

test("receivedCount > 0 produces a 'linkedin_replied' entry at lastMessageAt", () => {
  const lastMessageAt = new Date("2026-10-12T18:04:00Z");
  const result = buildConnectionTimelineEntries([
    { bdId: "bd-1", bdName: "Juan Martínez", sentCount: 1, receivedCount: 1, lastMessageAt },
  ]);
  assert.deepEqual(result, [
    {
      id: "connection-bd-1",
      type: "linkedin_replied",
      createdAt: lastMessageAt,
      metadata: { bdId: "bd-1", bdName: "Juan Martínez" },
    },
  ]);
});

test("sentCount > 0 with no reply produces a 'linkedin_sent' entry", () => {
  const lastMessageAt = new Date("2026-10-03T11:30:00Z");
  const result = buildConnectionTimelineEntries([
    { bdId: "bd-2", bdName: "Ana Pereyra", sentCount: 1, receivedCount: 0, lastMessageAt },
  ]);
  assert.equal(result[0].type, "linkedin_sent");
});

test("linkedinEntryAccess: the connection's own BD gets 'own' regardless of admin status", () => {
  assert.equal(linkedinEntryAccess("bd-1", "bd-1", false), "own");
  assert.equal(linkedinEntryAccess("bd-1", "bd-1", true), "own");
});

test("linkedinEntryAccess: an admin viewing someone else's connection gets 'admin-bypass'", () => {
  assert.equal(linkedinEntryAccess("bd-1", "bd-2", true), "admin-bypass");
});

test("linkedinEntryAccess: a non-admin viewing someone else's connection is 'locked'", () => {
  assert.equal(linkedinEntryAccess("bd-1", "bd-2", false), "locked");
});
