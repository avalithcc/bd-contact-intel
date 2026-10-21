import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTimelineEntry } from "@/lib/activity/timelineEntry";
import { groupTimelineEntries } from "@/lib/contacts/timelineGrouping";
import { resolveEffectiveActivityAt } from "@/lib/contacts/effectiveActivityTime";
import {
  groupEmailThreads,
  isInferredThread,
  isThreadAttributedThread,
  threadContextSummary,
  threadGroupToTimelineEntry,
} from "@/lib/contacts/emailThreads";

test("a lone email_sent row with a threadId stays a 'single' (no badge for 1 message)", () => {
  const entry = {
    id: "a1",
    type: "email_sent",
    createdAt: new Date("2026-10-13T09:12:00Z"),
    at: new Date("2026-10-13T09:12:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: true,
  };
  const result = groupEmailThreads([entry]);
  assert.deepEqual(result, [{ kind: "single", entry }]);
});

test("two email_sent rows sharing a threadId become one 'thread', oldest-first", () => {
  const a = {
    id: "a1",
    type: "email_sent",
    createdAt: new Date("2026-10-14T00:00:00Z"),
    at: new Date("2026-10-14T00:00:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: true,
  };
  const b = {
    id: "a2",
    type: "email_sent",
    createdAt: new Date("2026-10-13T09:12:00Z"),
    at: new Date("2026-10-13T09:12:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: true,
  };
  const result = groupEmailThreads([a, b]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "thread");
  if (result[0].kind === "thread") {
    assert.deepEqual(result[0].group.messages.map((m) => m.id), ["a2", "a1"]);
    assert.deepEqual(result[0].group.latestAt, a.at);
  }
});

test("entries with no gmailThreadId, or a non-email_sent type, pass through as 'single'", () => {
  const note = { id: "n1", type: "note", createdAt: new Date(), at: new Date(), metadata: { note: "x" }, visible: true };
  const bareEmail = { id: "a1", type: "email_sent", createdAt: new Date(), at: new Date(), metadata: {}, visible: true };
  const result = groupEmailThreads([note, bareEmail]);
  assert.deepEqual(result, [
    { kind: "single", entry: note },
    { kind: "single", entry: bareEmail },
  ]);
});

test("a reply_received row shares a thread with an email_sent row on the same gmailThreadId", () => {
  const sent = {
    id: "s1",
    type: "email_sent",
    createdAt: new Date("2026-10-13T16:02:00Z"),
    at: new Date("2026-10-13T16:02:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: true,
  };
  const reply = {
    id: "r1",
    type: "reply_received",
    createdAt: new Date("2026-10-14T09:15:00Z"),
    at: new Date("2026-10-14T09:15:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: true,
  };
  const result = groupEmailThreads([sent, reply]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "thread");
  if (result[0].kind === "thread") {
    assert.deepEqual(result[0].group.messages.map((m) => m.id), ["s1", "r1"]);
    assert.deepEqual(result[0].group.latestAt, reply.at);
  }
});

test("a lone reply_received row with a threadId stays a 'single' (no badge for 1 message)", () => {
  const entry = {
    id: "r1",
    type: "reply_received",
    createdAt: new Date("2026-10-14T09:15:00Z"),
    at: new Date("2026-10-14T09:15:00Z"),
    metadata: { gmailThreadId: "t2" },
    visible: true,
  };
  assert.deepEqual(groupEmailThreads([entry]), [{ kind: "single", entry }]);
});

test("a thread is 'visible' if at least one of its messages is", () => {
  const a = {
    id: "a1",
    type: "email_sent",
    createdAt: new Date("2026-10-14T00:00:00Z"),
    at: new Date("2026-10-14T00:00:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: false,
  };
  const b = {
    id: "a2",
    type: "email_sent",
    createdAt: new Date("2026-10-13T00:00:00Z"),
    at: new Date("2026-10-13T00:00:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: true,
  };
  const result = groupEmailThreads([a, b]);
  assert.equal(result[0].kind, "thread");
  if (result[0].kind === "thread") assert.equal(result[0].group.visible, true);
});

test("isInferredThread is true when any message matched through an inferred address", () => {
  const a = {
    id: "a1",
    type: "email_sent",
    createdAt: new Date("2026-10-13T00:00:00Z"),
    at: new Date("2026-10-13T00:00:00Z"),
    metadata: { gmailThreadId: "t1", matchConfidence: "exact" },
    visible: true,
  };
  const b = {
    id: "a2",
    type: "reply_received",
    createdAt: new Date("2026-10-14T00:00:00Z"),
    at: new Date("2026-10-14T00:00:00Z"),
    metadata: { gmailThreadId: "t1", matchConfidence: "inferred" },
    visible: true,
  };
  const result = groupEmailThreads([a, b]);
  assert.equal(result[0].kind, "thread");
  if (result[0].kind === "thread") assert.equal(isInferredThread(result[0].group), true);
});

test("isInferredThread is false when every message matched exactly", () => {
  const a = {
    id: "a1",
    type: "email_sent",
    createdAt: new Date("2026-10-13T00:00:00Z"),
    at: new Date("2026-10-13T00:00:00Z"),
    metadata: { gmailThreadId: "t1", matchConfidence: "exact" },
    visible: true,
  };
  const b = {
    id: "a2",
    type: "reply_received",
    createdAt: new Date("2026-10-14T00:00:00Z"),
    at: new Date("2026-10-14T00:00:00Z"),
    metadata: { gmailThreadId: "t1", matchConfidence: "exact" },
    visible: true,
  };
  const result = groupEmailThreads([a, b]);
  assert.equal(result[0].kind, "thread");
  if (result[0].kind === "thread") assert.equal(isInferredThread(result[0].group), false);
});

// --- threadContextSummary (email-sync.html:180's "Con <address> · <name> ·
// saliente/entrante" line — mockup-fidelity fix, 2026-10-01) -------------

test("threadContextSummary reads matchedEmail/direction off the LATEST message (outbound -> 'outbound')", () => {
  const older = {
    id: "a1",
    type: "reply_received",
    createdAt: new Date("2026-10-09T00:00:00Z"),
    at: new Date("2026-10-09T00:00:00Z"),
    metadata: { gmailThreadId: "t1", matchedEmail: "old@prospect.com" },
    visible: true,
  };
  const latest = {
    id: "a2",
    type: "email_sent",
    createdAt: new Date("2026-10-14T00:00:00Z"),
    at: new Date("2026-10-14T00:00:00Z"),
    metadata: { gmailThreadId: "t1", matchedEmail: "d.salazar@despegar.com" },
    visible: true,
  };
  const result = groupEmailThreads([older, latest]);
  assert.equal(result[0].kind, "thread");
  if (result[0].kind !== "thread") return;
  assert.deepEqual(threadContextSummary(result[0].group), {
    matchedEmail: "d.salazar@despegar.com",
    direction: "outbound",
  });
});

test("threadContextSummary reports 'inbound' for a thread whose latest message was received", () => {
  const sent = {
    id: "a1",
    type: "email_sent",
    createdAt: new Date("2026-10-13T00:00:00Z"),
    at: new Date("2026-10-13T00:00:00Z"),
    metadata: { gmailThreadId: "t1", matchedEmail: "v.rojas@mercadolibre.com" },
    visible: true,
  };
  const reply = {
    id: "a2",
    type: "reply_received",
    createdAt: new Date("2026-10-14T00:00:00Z"),
    at: new Date("2026-10-14T00:00:00Z"),
    metadata: { gmailThreadId: "t1", matchedEmail: "v.rojas@mercadolibre.com" },
    visible: true,
  };
  const result = groupEmailThreads([sent, reply]);
  assert.equal(result[0].kind, "thread");
  if (result[0].kind !== "thread") return;
  assert.deepEqual(threadContextSummary(result[0].group), {
    matchedEmail: "v.rojas@mercadolibre.com",
    direction: "inbound",
  });
});

test("threadContextSummary falls back to null matchedEmail when no message carries one", () => {
  const a = {
    id: "a1",
    type: "email_sent",
    createdAt: new Date("2026-10-13T00:00:00Z"),
    at: new Date("2026-10-13T00:00:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: true,
  };
  const b = {
    id: "a2",
    type: "email_sent",
    createdAt: new Date("2026-10-14T00:00:00Z"),
    at: new Date("2026-10-14T00:00:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: true,
  };
  const result = groupEmailThreads([a, b]);
  assert.equal(result[0].kind, "thread");
  if (result[0].kind !== "thread") return;
  assert.deepEqual(threadContextSummary(result[0].group), { matchedEmail: null, direction: "outbound" });
});

// --- isThreadAttributedThread: thread-level, independent of the latest message.

function mk(id: string, type: string, day: number, matchConfidence?: string) {
  return {
    id,
    type,
    createdAt: new Date(Date.UTC(2026, 9, day)),
    at: new Date(Date.UTC(2026, 9, day)),
    metadata: { gmailThreadId: "t1", ...(matchConfidence ? { matchConfidence } : {}) },
    visible: true,
  };
}

function groupOf(entries: ReturnType<typeof mk>[]) {
  const result = groupEmailThreads(entries);
  assert.equal(result[0].kind, "thread");
  if (result[0].kind !== "thread") throw new Error("expected thread");
  return result[0].group;
}

test("isThreadAttributedThread is true with one 'thread' message among several, even when it is not the latest", () => {
  const group = groupOf([
    mk("a", "email_sent", 10, "exact"),
    mk("b", "reply_received", 11, "thread"),
    mk("c", "email_sent", 12, "exact"),
  ]);
  assert.equal(isThreadAttributedThread(group), true);
});

test("isThreadAttributedThread is false when no message matched through the thread", () => {
  const group = groupOf([mk("a", "email_sent", 10, "exact"), mk("b", "reply_received", 11, "inferred"), mk("c", "email_sent", 12)]);
  assert.equal(isThreadAttributedThread(group), false);
});

test("a thread can be both inferred and thread-attributed; both predicates are true", () => {
  const group = groupOf([mk("a", "email_sent", 10, "inferred"), mk("b", "reply_received", 11, "thread")]);
  assert.equal(isInferredThread(group), true);
  assert.equal(isThreadAttributedThread(group), true);
});

test("isThreadAttributedThread does not depend on message order", () => {
  const entries = [mk("a", "email_sent", 10, "exact"), mk("b", "reply_received", 11, "thread"), mk("c", "email_sent", 12, "exact")];
  for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]]) {
    assert.equal(isThreadAttributedThread(groupOf(order.map((i) => entries[i]))), true);
  }
});

// Regression guard for a mistake made twice (status_backfill, then Gmail-synced mail):
// a row's display time is its EFFECTIVE time (`at`), never `created_at`. The Gmail sync
// writes `created_at` when it runs; the real send time is `metadata.occurredAt`. Shaped
// like the real prod rows: created_at a year after occurredAt.
test("a thread card is dated and bucketed by when the mail was sent, not when the sync wrote the row", () => {
  const syncRanAt = new Date("2026-10-06T04:48:10.097Z");
  const row = (id: string, occurredAt: string) =>
    buildTimelineEntry(
      {
        id,
        type: "email_sent",
        createdAt: syncRanAt,
        actorBdId: "bd-1",
        actorName: "BD",
        metadata: { gmailThreadId: "t1", occurredAt },
      },
      "bd-1",
    );
  const older = row("e1", "2025-07-03T20:14:42.000Z");
  const newer = row("e2", "2025-07-03T20:26:09.000Z");

  const [threaded] = groupEmailThreads([newer, older]);
  assert.equal(threaded.kind, "thread");
  if (threaded.kind !== "thread") return;
  assert.deepEqual(threaded.group.messages.map((m) => m.id), ["e1", "e2"]);
  assert.equal(threaded.group.latestAt.toISOString(), "2025-07-03T20:26:09.000Z");

  const [bucket] = groupTimelineEntries([threadGroupToTimelineEntry(threaded.group)]);
  assert.equal(bucket.monthKey, "2025-07");
  assert.equal(bucket.items[0].at.toISOString(), "2025-07-03T20:26:09.000Z");
});

test("grouping does not mutate its input", () => {
  const mk = (id: string, at: string) => ({
    id,
    type: "email_sent",
    createdAt: new Date("2026-10-06T04:48:10Z"),
    at: new Date(at),
    metadata: { gmailThreadId: "t1" } as Record<string, unknown>,
    visible: true,
  });
  const input = [mk("b", "2025-07-03T20:26:09Z"), mk("a", "2025-07-03T20:14:42Z")];
  const first = groupEmailThreads(input);
  assert.deepEqual(input.map((e) => e.id), ["b", "a"]);
  assert.deepEqual(groupEmailThreads(input), first);
});

// Anti-drift. The thread card's date is correct ONLY while the synthetic
// entry's EFFECTIVE time equals the newest message's. Two unrelated changes
// could break that silently — dropping "email_sent" from
// OCCURRED_AT_ACTIVITY_TYPES, or changing how the synthetic carries its time —
// and the symptom is a card dated when the Gmail sync ran, a year off. This
// repo has shipped that bug twice (status_backfill, then Gmail threads), so
// the invariant is asserted directly, not the mechanism satisfying it today.
test("anti-drift: the synthetic thread entry's EFFECTIVE time is the newest message's, never the sync's createdAt", () => {
  const syncRanAt = new Date("2026-10-06T04:48:10.097Z");
  const row = (id: string, occurredAt: string) =>
    buildTimelineEntry(
      { id, type: "email_sent", createdAt: syncRanAt, actorBdId: "bd-1", actorName: "BD", metadata: { gmailThreadId: "t1", occurredAt } },
      "bd-1",
    );
  const [threaded] = groupEmailThreads([row("e2", "2025-07-03T20:26:09.000Z"), row("e1", "2025-07-03T20:14:42.000Z")]);
  assert.equal(threaded.kind, "thread");
  if (threaded.kind !== "thread") return;

  const effective = resolveEffectiveActivityAt({ ...threadGroupToTimelineEntry(threaded.group), deletedAt: null });
  assert.equal(effective?.toISOString(), "2025-07-03T20:26:09.000Z");
  assert.notEqual(effective?.toISOString(), syncRanAt.toISOString());
});
