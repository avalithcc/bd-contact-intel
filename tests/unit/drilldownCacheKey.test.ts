import assert from "node:assert/strict";
import { test } from "node:test";
import { drilldownCacheKey } from "@/lib/reports/drilldownCacheKey";

const base = { kind: "replied", fromIso: "2026-10-01T00:00:00.000Z", toIso: "2026-10-08T00:00:00.000Z", bdId: null as string | null };

test("same filters give the same key", () => {
  assert.equal(drilldownCacheKey({ ...base }), drilldownCacheKey({ ...base }));
});

test("two different BDs give different keys", () => {
  assert.notEqual(drilldownCacheKey({ ...base, bdId: "a" }), drilldownCacheKey({ ...base, bdId: "b" }));
});

test("a null bdId is distinct from a set one", () => {
  assert.notEqual(drilldownCacheKey({ ...base, bdId: null }), drilldownCacheKey({ ...base, bdId: "a" }));
});

test("kind and period each change the key", () => {
  const k = drilldownCacheKey(base);
  assert.notEqual(drilldownCacheKey({ ...base, kind: "contacted" }), k);
  assert.notEqual(drilldownCacheKey({ ...base, fromIso: "2026-09-01T00:00:00.000Z" }), k);
  assert.notEqual(drilldownCacheKey({ ...base, toIso: "2026-10-09T00:00:00.000Z" }), k);
});

test("separator characters in a field cannot collide keys", () => {
  assert.notEqual(
    drilldownCacheKey({ ...base, kind: "a|b", fromIso: "c" }),
    drilldownCacheKey({ ...base, kind: "a", fromIso: "b|c" }),
  );
});

test("a missing period (won companies) is distinct from a set one", () => {
  assert.notEqual(
    drilldownCacheKey({ kind: "won", bdId: null }),
    drilldownCacheKey({ kind: "won", fromIso: "x", toIso: "y", bdId: null }),
  );
});
