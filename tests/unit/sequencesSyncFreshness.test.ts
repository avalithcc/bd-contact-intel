import assert from "node:assert/strict";
import { test } from "node:test";
import { SEQUENCE_SYNC_STALE_MS } from "@/lib/sequences/config";
import { isSyncFreshEnough } from "@/lib/sequences/syncFreshness";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-10-15T14:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const fresh = (lastSyncedAt: Date | null) => isSyncFreshEnough({ lastSyncedAt, now, staleAfterMs: SEQUENCE_SYNC_STALE_MS });

test("the stale threshold is the daily safety net plus the spec's 2h grace: 26h", () => {
  assert.equal(SEQUENCE_SYNC_STALE_MS, 26 * HOUR);
});

test("a sync 3 hours ago is fresh", () => {
  assert.equal(fresh(ago(3 * HOUR)), true);
});

test("a sync exactly at the threshold is still fresh, one millisecond past it is stale", () => {
  assert.equal(fresh(ago(26 * HOUR)), true);
  assert.equal(fresh(ago(26 * HOUR + 1)), false);
});

test("a sync 40 hours ago is stale", () => {
  assert.equal(fresh(ago(40 * HOUR)), false);
});

test("an account that never synced (null) is stale: unknown must not read as fresh", () => {
  assert.equal(fresh(null), false);
});
