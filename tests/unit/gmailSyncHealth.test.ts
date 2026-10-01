import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySyncError, deriveSyncHealth, SYNC_STALE_AFTER_MS } from "@/lib/gmail/syncHealth";

const NOW = new Date("2026-10-01T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const base = {
  status: "connected",
  syncError: null,
  lastSyncedAt: minutesAgo(10),
  connectedAt: minutesAgo(60 * 24 * 30),
  now: NOW,
};

test("healthy: connected, no error, synced within the threshold", () => {
  assert.deepEqual(deriveSyncHealth(base), { state: "ok", errorKind: null, sinceMs: 10 * 60_000 });
});

test("exactly at the threshold is still ok; one minute over is stale", () => {
  const edge = deriveSyncHealth({ ...base, lastSyncedAt: new Date(NOW.getTime() - SYNC_STALE_AFTER_MS) });
  assert.equal(edge.state, "ok");
  const over = deriveSyncHealth({ ...base, lastSyncedAt: new Date(NOW.getTime() - SYNC_STALE_AFTER_MS - 60_000) });
  assert.equal(over.state, "stale");
});

test("error present wins over a recent timestamp", () => {
  const h = deriveSyncHealth({ ...base, syncError: "Gmail messages.get failed: 404 {...}" });
  assert.equal(h.state, "failing");
  assert.equal(h.errorKind, "other");
});

test("error present and stale is still failing (the error is the more specific signal)", () => {
  const h = deriveSyncHealth({ ...base, syncError: "boom", lastSyncedAt: minutesAgo(60 * 6) });
  assert.equal(h.state, "failing");
  assert.equal(h.sinceMs, 6 * 60 * 60_000);
});

test("no error but a long gap is stale", () => {
  const h = deriveSyncHealth({ ...base, lastSyncedAt: minutesAgo(60 * 6) });
  assert.deepEqual(h, { state: "stale", errorKind: null, sinceMs: 6 * 60 * 60_000 });
});

test("disconnected account has no sync health to report", () => {
  assert.equal(deriveSyncHealth({ ...base, status: "revoked", syncError: "x" }).state, "inactive");
  assert.equal(deriveSyncHealth({ ...base, status: null }).state, "inactive");
});

test("never synced: judged against connectedAt, so a fresh connection is ok", () => {
  const fresh = deriveSyncHealth({ ...base, lastSyncedAt: null, connectedAt: minutesAgo(5) });
  assert.deepEqual(fresh, { state: "ok", errorKind: null, sinceMs: null });
});

test("never synced long after connecting is stale, with no 'last success' to show", () => {
  const h = deriveSyncHealth({ ...base, lastSyncedAt: null, connectedAt: minutesAgo(60 * 3) });
  assert.deepEqual(h, { state: "stale", errorKind: null, sinceMs: null });
});

test("never synced with an error is failing and has no last success", () => {
  const h = deriveSyncHealth({ ...base, lastSyncedAt: null, syncError: "boom" });
  assert.deepEqual(h, { state: "failing", errorKind: "other", sinceMs: null });
});

test("a future timestamp (clock skew) never reads as stale", () => {
  assert.equal(deriveSyncHealth({ ...base, lastSyncedAt: minutesAgo(-5) }).state, "ok");
});

test("classifySyncError separates what reconnecting fixes from what it does not", () => {
  assert.equal(classifySyncError("Gmail authorization was revoked or expired (invalid_grant)"), "auth");
  assert.equal(classifySyncError("Gmail OAuth is misconfigured (invalid_client)"), "config");
  assert.equal(classifySyncError("Gmail is not configured on the server (missing: X)."), "config");
  assert.equal(classifySyncError('Gmail messages.get failed: 404 {"error":{}}'), "other");
  assert.equal(classifySyncError(null), null);
  assert.equal(classifySyncError("   "), null);
});
