/**
 * Unit tests for src/lib/status/deriveStatus.ts's `deriveStatusFull` (mockup-
 * port r02; contact-record.html's "Estado" derivation "why" hint). Same pure,
 * no-DB contract as `deriveStatus` — `deriveStatusFull` additionally reports
 * the effective timestamp (`at`) of whichever event decided the status, so
 * the record page can render "el {date}" without a second query. Every
 * `deriveStatusFull` result must agree with `deriveStatus` on `status` and
 * `because` for the same input (deriveStatusFull is a strict superset).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStatusReasonEvidence,
  connectionRowToStatusEvent,
  deriveStatus,
  deriveStatusFull,
  type StatusEvent,
} from "@/lib/status/deriveStatus";

function activityEvent(overrides: { id: string; type: string; at: Date; status?: string }): StatusEvent {
  return { kind: "activity", ...overrides } as StatusEvent;
}

test("no events: 'new' status, no because, no at", () => {
  const result = deriveStatusFull([]);
  assert.deepEqual(result, { status: "new", because: null, at: null });
});

test("agrees with deriveStatus on status/because for a mixed event set", () => {
  const events: StatusEvent[] = [
    activityEvent({ id: "a1", type: "email_sent", at: new Date("2026-10-01T00:00:00Z") }),
    connectionRowToStatusEvent({
      bdId: "bd-1",
      sentCount: 0,
      receivedCount: 2,
      lastMessageAt: new Date("2026-10-12T18:04:00Z"),
    }),
  ];
  const base = deriveStatus(events);
  const full = deriveStatusFull(events);
  assert.deepEqual(full.status, base.status);
  assert.deepEqual(full.because, base.because);
});

test("connection-sourced 'replied' reports the connection's lastMessageAt as `at`", () => {
  const lastMessageAt = new Date("2026-10-12T18:04:00Z");
  const events: StatusEvent[] = [
    connectionRowToStatusEvent({ bdId: "bd-1", sentCount: 1, receivedCount: 1, lastMessageAt }),
  ];
  const result = deriveStatusFull(events);
  assert.equal(result.status, "replied");
  assert.deepEqual(result.because, { source: "connection", bdId: "bd-1" });
  assert.deepEqual(result.at, lastMessageAt);
});

test("activity-sourced discard reports the discard activity's `at`", () => {
  const discardedAt = new Date("2026-09-24T12:00:00Z");
  const events: StatusEvent[] = [
    activityEvent({ id: "a1", type: "email_sent", at: new Date("2026-09-01T00:00:00Z") }),
    activityEvent({ id: "a2", type: "discarded", at: discardedAt }),
  ];
  const result = deriveStatusFull(events);
  assert.equal(result.status, "discarded");
  assert.deepEqual(result.because, { source: "activity", activityId: "a2" });
  assert.deepEqual(result.at, discardedAt);
});

// --- buildStatusReasonEvidence (mockup-port r02: record page "why" hint) ---

test("buildStatusReasonEvidence: null derived.because -> null evidence", () => {
  const result = buildStatusReasonEvidence({ status: "new", because: null, at: null }, [], []);
  assert.equal(result, null);
});

test("buildStatusReasonEvidence: connection-sourced reason resolves bdName from already-fetched rows", () => {
  const at = new Date("2026-10-12T18:04:00Z");
  const result = buildStatusReasonEvidence(
    { status: "replied", because: { source: "connection", bdId: "bd-1" }, at },
    [{ bdId: "bd-1", bdName: "Juan Martínez" }],
    [],
  );
  assert.deepEqual(result, {
    status: "replied",
    because: { source: "connection", bdId: "bd-1" },
    at,
    bdName: "Juan Martínez",
    activityType: null,
  });
});

test("buildStatusReasonEvidence: activity-sourced reason resolves activityType from already-fetched rows", () => {
  const at = new Date("2026-10-13T09:12:00Z");
  const result = buildStatusReasonEvidence(
    { status: "contacted", because: { source: "activity", activityId: "a1" }, at },
    [],
    [{ id: "a1", type: "email_sent" }],
  );
  assert.deepEqual(result, {
    status: "contacted",
    because: { source: "activity", activityId: "a1" },
    at,
    bdName: null,
    activityType: "email_sent",
  });
});
