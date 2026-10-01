import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAfterSyncSet } from "@/lib/gmail/afterSyncPatch";

const NOW = new Date("2026-10-01T12:00:00Z");

test("a successful run (syncError null) advances lastSyncedAt", () => {
  const set = buildAfterSyncSet({ historyId: "42", syncError: null }, NOW);
  assert.deepEqual(set, { historyId: "42", syncError: null, lastSyncedAt: NOW, updatedAt: NOW });
});

test("a run that omits syncError counts as success", () => {
  assert.equal(buildAfterSyncSet({ backfillPageToken: "t" }, NOW).lastSyncedAt, NOW);
});

test("a failed run records the error but must NOT advance lastSyncedAt", () => {
  const set = buildAfterSyncSet({ syncError: "Gmail messages.get failed: 404" }, NOW);
  assert.equal(set.syncError, "Gmail messages.get failed: 404");
  assert.equal("lastSyncedAt" in set, false);
  assert.equal(set.updatedAt, NOW);
});
