import assert from "node:assert/strict";
import { mock, test } from "node:test";

// Goes through the REAL `updateAccountAfterSync` (not just the pure helper):
// the helper was once imported there and never called, so its own unit test
// stayed green while `last_synced_at` kept advancing on failures. postgres-js
// connects lazily, so a placeholder URL is enough to import `@/db`; only
// `db.update` is stubbed, to capture what the writer actually hands Drizzle.
process.env.DATABASE_URL ??= "postgres://unit:unit@127.0.0.1:1/unit";

async function captureSet(patch: Parameters<typeof import("@/lib/gmail/syncQueries").updateAccountAfterSync>[1]) {
  const { db } = await import("@/db");
  const { updateAccountAfterSync } = await import("@/lib/gmail/syncQueries");
  let captured: Record<string, unknown> | null = null;
  const stub = mock.method(db, "update", (() => ({
    set: (values: Record<string, unknown>) => {
      captured = values;
      return { where: async () => undefined };
    },
  })) as unknown as typeof db.update);
  try {
    await updateAccountAfterSync("bd-1", patch);
  } finally {
    stub.mock.restore();
  }
  assert.ok(captured, "the writer must reach db.update().set()");
  return captured as Record<string, unknown>;
}

test("real writer: a successful run advances last_synced_at", async () => {
  const set = await captureSet({ historyId: "42", syncError: null });
  assert.ok(set.lastSyncedAt instanceof Date);
  assert.equal(set.syncError, null);
});

test("real writer: a failed run records the error and does NOT touch last_synced_at", async () => {
  const set = await captureSet({ syncError: "Gmail messages.get failed: 404" });
  assert.equal(set.syncError, "Gmail messages.get failed: 404");
  assert.equal("lastSyncedAt" in set, false);
  assert.ok(set.updatedAt instanceof Date);
});
