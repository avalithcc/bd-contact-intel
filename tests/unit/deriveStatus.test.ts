/**
 * Unit tests for src/lib/status/deriveStatus.ts — the pure status-derivation
 * algorithm (design.md "Status derivation (R4)"). Pure, no DB: `events` is
 * the combined set of activity- and connection-derived evidence for one
 * person, built by the (thin, DB-only) caller.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveStatus, type StatusEvent } from "@/lib/status/deriveStatus";

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
