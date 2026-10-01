import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildReconnectSyncReset } from "@/lib/gmail/reconnectPatch";
import { deriveSyncHealth } from "@/lib/gmail/syncHealth";

const NOW = new Date("2026-10-01T12:00:00Z");

test("reconnect clears the error and restarts the clock", () => {
  assert.deepEqual(buildReconnectSyncReset(NOW), { syncError: null, lastSyncedAt: null, connectedAt: NOW });
});

test("right after a reconnect the account is healthy, not failing or stale", () => {
  const reset = buildReconnectSyncReset(NOW);
  const h = deriveSyncHealth({ status: "connected", now: NOW, ...reset });
  assert.equal(h.state, "ok");
});

// The callback needs a live OAuth exchange, so it cannot run here. This
// asserts the wiring itself: the reset must be spread into the upsert's
// conflict-update set (the path a RE-connection takes), not just exist.
test("the OAuth callback applies the reset on the re-connection (onConflictDoUpdate) path", () => {
  const src = readFileSync("src/app/api/gmail/oauth/callback/route.ts", "utf8");
  const update = src.slice(src.indexOf("onConflictDoUpdate"));
  assert.match(update, /\.\.\.buildReconnectSyncReset\(/);
});
