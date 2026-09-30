/**
 * Regression test for the "Todo" timeline merge (owner decision 2026-09-30:
 * synthesized LinkedIn entries render interleaved with real activity, in
 * the unfiltered "Todo" view only, with no dedicated "LinkedIn" pill).
 * Exercises the exact combination Timeline.tsx performs — mapping
 * `buildConnectionTimelineEntries`' output into `groupTimelineEntries`'
 * input shape and concatenating it with real entries — without needing to
 * render the client component itself (no React rendering harness in this
 * repo's test:unit; see tests/unit/timelineGrouping.test.ts for the same
 * convention).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConnectionTimelineEntries, type ConnectionForTimeline } from "@/lib/contacts/connectionTimelineEntries";
import { groupTimelineEntries } from "@/lib/contacts/timelineGrouping";

function toGroupingEntry(e: ReturnType<typeof buildConnectionTimelineEntries>[number]) {
  return { id: e.id, type: e.type, createdAt: e.createdAt, metadata: e.metadata };
}

test("'Todo' merge: real activity and synthesized LinkedIn entries interleave chronologically within the same month bucket", () => {
  const connections: ConnectionForTimeline[] = [
    { bdId: "bd-1", bdName: "Juan Martínez", sentCount: 1, receivedCount: 1, lastMessageAt: new Date("2026-10-12T18:04:00Z") },
    { bdId: "bd-2", bdName: "Ana Pereyra", sentCount: 1, receivedCount: 0, lastMessageAt: new Date("2026-10-03T11:30:00Z") },
  ];
  const linkedinEntries = buildConnectionTimelineEntries(connections);
  const real = [
    { id: "note-1", type: "note", createdAt: new Date("2026-10-02T16:45:00Z"), metadata: {} },
    { id: "call-1", type: "call", createdAt: new Date("2026-10-15T10:20:00Z"), metadata: {} },
  ];

  const groups = groupTimelineEntries([...real, ...linkedinEntries.map(toGroupingEntry)]);

  assert.equal(groups.length, 1, "every entry falls in October 2026");
  const order = groups[0].items.map((i) => i.entry.id);
  // Newest first: the 15th call, then the 12th LinkedIn reply, then the 3rd
  // LinkedIn message, then the 2nd note — LinkedIn entries are never grouped
  // separately from real activity, matching the mockup's single interleaved
  // list (contact-record.html:120-141).
  assert.deepEqual(order, ["call-1", "connection-bd-1", "connection-bd-2", "note-1"]);
});

test("'Todo' merge: a connection with no message history contributes no entry to the merge", () => {
  const connections: ConnectionForTimeline[] = [
    { bdId: "bd-1", bdName: "Ana", sentCount: 0, receivedCount: 0, lastMessageAt: null },
  ];
  const linkedinEntries = buildConnectionTimelineEntries(connections);
  const groups = groupTimelineEntries(linkedinEntries.map(toGroupingEntry));
  assert.deepEqual(groups, []);
});
