/**
 * Unit tests for src/lib/status/deriveStatus.ts — the pure status-derivation
 * algorithm (design.md "Status derivation (R4)"). Pure, no DB: `events` is
 * the combined set of activity- and connection-derived evidence for one
 * person, built by the (thin, DB-only) caller.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityRowToStatusEvent,
  buildPersonStatusUpdates,
  connectionRowToStatusEvent,
  deriveStatus,
  type StatusEvent,
} from "@/lib/status/deriveStatus";

function activityEvent(
  overrides: Partial<Extract<StatusEvent, { kind: "activity" }>> & { id: string; type: string; at: Date },
): StatusEvent {
  return { kind: "activity", ...overrides };
}

function connectionEvent(
  overrides: Partial<Extract<StatusEvent, { kind: "connection" }>> & { bdId: string },
): StatusEvent {
  return {
    kind: "connection",
    sentCount: 0,
    receivedCount: 0,
    at: null,
    ...overrides,
  };
}

test("no events at all -> new, no because", () => {
  const result = deriveStatus([]);
  assert.deepEqual(result, { status: "new", because: null });
});

test("informational activity types (note, hunter_lookup) do not move the stage", () => {
  const result = deriveStatus([
    activityEvent({ id: "a1", type: "note", at: new Date("2026-01-01") }),
    activityEvent({ id: "a2", type: "hunter_lookup", at: new Date("2026-01-02") }),
  ]);
  assert.equal(result.status, "new");
});

test("email_sent activity advances stage to contacted", () => {
  const result = deriveStatus([
    activityEvent({ id: "a1", type: "email_sent", at: new Date("2026-01-01") }),
  ]);
  assert.equal(result.status, "contacted");
  assert.deepEqual(result.because, { source: "activity", activityId: "a1" });
});

test("meeting_logged activity advances stage to meeting", () => {
  const result = deriveStatus([
    activityEvent({ id: "a1", type: "email_sent", at: new Date("2026-01-01") }),
    activityEvent({ id: "a2", type: "meeting_logged", at: new Date("2026-01-02") }),
  ]);
  assert.equal(result.status, "meeting");
  assert.deepEqual(result.because, { source: "activity", activityId: "a2" });
});

test("status_change/status_backfill activities carry a stage via metadata.status", () => {
  const result = deriveStatus([
    activityEvent({
      id: "a1",
      type: "status_change",
      at: new Date("2026-01-01"),
      status: "replied",
    }),
  ]);
  assert.equal(result.status, "replied");
  assert.deepEqual(result.because, { source: "activity", activityId: "a1" });
});

test("combined multi-BD connection activity picks the most advanced stage across BDs", () => {
  const result = deriveStatus([
    connectionEvent({ bdId: "bd-a", sentCount: 1, receivedCount: 0, at: new Date("2026-01-01") }),
    connectionEvent({ bdId: "bd-b", sentCount: 0, receivedCount: 1, at: new Date("2026-01-02") }),
  ]);
  assert.equal(result.status, "replied");
  assert.deepEqual(result.because, { source: "connection", bdId: "bd-b" });
});

test("a connection with sentCount>0 but no receivedCount stays at contacted", () => {
  const result = deriveStatus([
    connectionEvent({ bdId: "bd-a", sentCount: 2, receivedCount: 0, at: new Date("2026-01-01") }),
  ]);
  assert.equal(result.status, "contacted");
});

test("discarded activity newer than every stage event -> discarded", () => {
  const result = deriveStatus([
    activityEvent({ id: "a1", type: "email_sent", at: new Date("2026-01-01") }),
    activityEvent({ id: "a2", type: "discarded", at: new Date("2026-01-05") }),
  ]);
  assert.equal(result.status, "discarded");
  assert.deepEqual(result.because, { source: "activity", activityId: "a2" });
});

test("discard un-discarded by a later activity", () => {
  const result = deriveStatus([
    activityEvent({ id: "a1", type: "discarded", at: new Date("2026-01-01") }),
    activityEvent({ id: "a2", type: "email_sent", at: new Date("2026-01-05") }),
  ]);
  assert.equal(result.status, "contacted");
  assert.deepEqual(result.because, { source: "activity", activityId: "a2" });
});

test("discard with zero stage events is discarded (vacuously newer than every stage event)", () => {
  const result = deriveStatus([
    activityEvent({ id: "a1", type: "discarded", at: new Date("2026-01-01") }),
  ]);
  assert.equal(result.status, "discarded");
});

test("only the latest discard matters when several exist", () => {
  const result = deriveStatus([
    activityEvent({ id: "a1", type: "email_sent", at: new Date("2026-01-01") }),
    activityEvent({ id: "a2", type: "discarded", at: new Date("2026-01-02") }),
    activityEvent({ id: "a3", type: "meeting_logged", at: new Date("2026-01-03") }),
    activityEvent({ id: "a4", type: "discarded", at: new Date("2026-01-04") }),
  ]);
  assert.equal(result.status, "discarded");
  assert.deepEqual(result.because, { source: "activity", activityId: "a4" });
});

test("status_change carrying status:'discarded' counts as a discard event, not a stage", () => {
  const result = deriveStatus([
    activityEvent({ id: "a1", type: "email_sent", at: new Date("2026-01-01") }),
    activityEvent({ id: "a2", type: "status_change", at: new Date("2026-01-02"), status: "discarded" }),
  ]);
  assert.equal(result.status, "discarded");
  assert.deepEqual(result.because, { source: "activity", activityId: "a2" });
});

// --- Row builders (task 5.2): the thin, DB-facing type/metadata mapping
// deriveStatus() itself doesn't need to know about. ---------------------

test("activityRowToStatusEvent leaves plain types (note, email_sent) with no status field", () => {
  const createdAt = new Date("2026-01-01");
  assert.deepEqual(activityRowToStatusEvent({ id: "a1", type: "email_sent", createdAt, metadata: {} }), {
    kind: "activity",
    id: "a1",
    type: "email_sent",
    at: createdAt,
    status: undefined,
  });
});

test("activityRowToStatusEvent reads status_change's metadata.status", () => {
  const createdAt = new Date("2026-01-01");
  const event = activityRowToStatusEvent({
    id: "a1",
    type: "status_change",
    createdAt,
    metadata: { status: "replied" },
  });
  assert.equal(event.status, "replied");
  assert.equal(event.at, createdAt);
});

test("activityRowToStatusEvent maps a bare discarded row to status:'discarded'", () => {
  const event = activityRowToStatusEvent({
    id: "a1",
    type: "discarded",
    createdAt: new Date("2026-01-01"),
    metadata: { reason: "not_interested" },
  });
  assert.equal(event.status, "discarded");
});

test("activityRowToStatusEvent uses status_backfill's metadata.originalAt, not createdAt, as the event time", () => {
  const originalAt = new Date("2020-05-01");
  const createdAt = new Date("2026-01-01");
  const event = activityRowToStatusEvent({
    id: "a1",
    type: "status_backfill",
    createdAt,
    metadata: { status: "meeting", originalAt: originalAt.toISOString(), originalEditorBdId: "bd-1" },
  });
  assert.equal(event.status, "meeting");
  assert.deepEqual(event.at, originalAt);
});

test("activityRowToStatusEvent falls back to createdAt when status_backfill's originalAt is missing/invalid", () => {
  const createdAt = new Date("2026-01-01");
  const event = activityRowToStatusEvent({
    id: "a1",
    type: "status_backfill",
    createdAt,
    metadata: { status: "meeting", originalAt: "not-a-date" },
  });
  assert.deepEqual(event.at, createdAt);
});

test("connectionRowToStatusEvent maps person_bd_connection columns 1:1", () => {
  const lastMessageAt = new Date("2026-01-02");
  assert.deepEqual(
    connectionRowToStatusEvent({ bdId: "bd-1", sentCount: 2, receivedCount: 1, lastMessageAt }),
    { kind: "connection", bdId: "bd-1", sentCount: 2, receivedCount: 1, at: lastMessageAt },
  );
});

test("buildPersonStatusUpdates: groups rows per person and derives one update each (fresh-review fix 1)", () => {
  const connectedAt = new Date("2025-12-01");
  const emailSentAt = new Date("2026-01-01");
  const meetingAt = new Date("2026-01-05");
  const updates = buildPersonStatusUpdates(
    ["p1", "p2", "p3"],
    [
      { id: "a1", type: "email_sent", createdAt: emailSentAt, metadata: {}, personId: "p1" },
      { id: "a2", type: "meeting_logged", createdAt: meetingAt, metadata: {}, personId: "p2" },
    ],
    [{ bdId: "bd-1", sentCount: 1, receivedCount: 0, lastMessageAt: connectedAt, personId: "p1" }],
  );

  assert.deepEqual(updates, [
    { personId: "p1", status: "contacted", statusActivityId: "a1" },
    { personId: "p2", status: "meeting", statusActivityId: "a2" },
    { personId: "p3", status: "new", statusActivityId: null },
  ]);
});

test("buildPersonStatusUpdates: rows for a personId not in the requested list are ignored", () => {
  const updates = buildPersonStatusUpdates(
    ["p1"],
    [{ id: "a1", type: "email_sent", createdAt: new Date(), metadata: {}, personId: "stray" }],
    [],
  );
  assert.deepEqual(updates, [{ personId: "p1", status: "new", statusActivityId: null }]);
});
