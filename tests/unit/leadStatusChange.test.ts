/**
 * Unit tests for src/lib/leads/statusChange.ts (task 4B.6).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planStatusChangeActivity } from "@/lib/leads/statusChange";

test("planStatusChangeActivity: a status edit produces status_change metadata", () => {
  assert.deepEqual(planStatusChangeActivity({ status: "meeting" }), { status: "meeting" });
});

test("planStatusChangeActivity: a notes-only update (no status field) produces nothing", () => {
  assert.equal(planStatusChangeActivity({}), null);
});
