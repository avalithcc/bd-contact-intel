import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isLinkedinEntryLocked,
  linkedinTimelineTotal,
  resolveLockedConnectionCardRows,
} from "@/lib/contacts/conversationHistoryAccess";
import type { ConnectionForTimeline } from "@/lib/contacts/connectionTimelineEntries";

test("isLinkedinEntryLocked: the connection's own BD is never locked", () => {
  assert.equal(isLinkedinEntryLocked("own"), false);
});

test("isLinkedinEntryLocked: admin-bypass is locked in the interleaved 'Todo' timeline (no inline reveal restored)", () => {
  assert.equal(isLinkedinEntryLocked("admin-bypass"), true);
});

test("isLinkedinEntryLocked: a non-admin viewing someone else's connection is locked", () => {
  assert.equal(isLinkedinEntryLocked("locked"), true);
});

test("linkedinTimelineTotal: one unit per connection with real message history, not a raw message count", () => {
  const connections: ConnectionForTimeline[] = [
    { bdId: "bd-1", bdName: "Ana", sentCount: 3, receivedCount: 2, lastMessageAt: new Date("2026-10-01T00:00:00Z") },
    { bdId: "bd-2", bdName: "Juan", sentCount: 0, receivedCount: 0, lastMessageAt: null },
    { bdId: "bd-3", bdName: "Cristian", sentCount: 1, receivedCount: 0, lastMessageAt: new Date("2026-09-01T00:00:00Z") },
  ];
  assert.equal(linkedinTimelineTotal(connections), 2);
});

test("linkedinTimelineTotal: no connections with history is 0", () => {
  assert.equal(linkedinTimelineTotal([]), 0);
});

// resolveLockedConnectionCardRows: bugfix 2026-09-30 — the right-rail
// "Historial de conversaciones" card used to render NOTHING for a non-admin
// viewing another BD's connection, even though the interleaved "Todo"
// timeline already showed a locked marker for that exact same connection
// (isLinkedinEntryLocked above). This is the pure set both surfaces must now
// agree on.

test("resolveLockedConnectionCardRows: excludes the viewer's own connection", () => {
  const connections: ConnectionForTimeline[] = [
    { bdId: "me", bdName: "Cristian", sentCount: 1, receivedCount: 0, lastMessageAt: new Date("2026-09-01T00:00:00Z") },
    { bdId: "other", bdName: "Ana", sentCount: 2, receivedCount: 1, lastMessageAt: new Date("2026-09-05T00:00:00Z") },
  ];
  assert.deepEqual(resolveLockedConnectionCardRows(connections, "me"), [{ bdId: "other", bdName: "Ana" }]);
});

test("resolveLockedConnectionCardRows: a connection with no real message history is never a locked row", () => {
  const connections: ConnectionForTimeline[] = [
    { bdId: "other", bdName: "Ana", sentCount: 0, receivedCount: 0, lastMessageAt: null },
  ];
  assert.deepEqual(resolveLockedConnectionCardRows(connections, "me"), []);
});

test("resolveLockedConnectionCardRows: empty connections is empty", () => {
  assert.deepEqual(resolveLockedConnectionCardRows([], "me"), []);
});
