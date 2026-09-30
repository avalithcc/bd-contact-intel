import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSyncCooldown } from "@/lib/gmail/syncCooldown";

const NOW = new Date("2026-10-01T12:00:00Z");

test("allows a manual sync when never synced before and no backfill in progress", () => {
  const result = checkSyncCooldown({ lastSyncedAt: null, backfillPageToken: null, now: NOW });
  assert.deepEqual(result, { ok: true });
});

test("allows a manual sync once the cooldown window has fully elapsed", () => {
  const result = checkSyncCooldown({
    lastSyncedAt: new Date(NOW.getTime() - 60_000),
    backfillPageToken: null,
    now: NOW,
  });
  assert.deepEqual(result, { ok: true });
});

test("refuses a manual sync less than 60s after the last one", () => {
  const result = checkSyncCooldown({
    lastSyncedAt: new Date(NOW.getTime() - 30_000),
    backfillPageToken: null,
    now: NOW,
  });
  assert.deepEqual(result, { ok: false, reason: "cooldown" });
});

test("refuses a manual sync exactly at the 59-second mark (boundary, still inside the cooldown)", () => {
  const result = checkSyncCooldown({
    lastSyncedAt: new Date(NOW.getTime() - 59_999),
    backfillPageToken: null,
    now: NOW,
  });
  assert.deepEqual(result, { ok: false, reason: "cooldown" });
});

test("refuses a manual sync while a first-sync backfill is visibly in progress, even outside the cooldown window", () => {
  const result = checkSyncCooldown({
    lastSyncedAt: new Date(NOW.getTime() - 10 * 60_000),
    backfillPageToken: "page-token-123",
    now: NOW,
  });
  assert.deepEqual(result, { ok: false, reason: "in_progress" });
});

test("backfill-in-progress wins over the cooldown reason when both would apply", () => {
  const result = checkSyncCooldown({
    lastSyncedAt: new Date(NOW.getTime() - 1_000),
    backfillPageToken: "page-token-123",
    now: NOW,
  });
  assert.deepEqual(result, { ok: false, reason: "in_progress" });
});
