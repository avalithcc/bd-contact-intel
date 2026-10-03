/**
 * Pins `TIMELINE_ACTIVITY_TYPES` (src/lib/activity/queries.ts) includes
 * `reply_received` (email-sync brief follow-up review) — a synced Gmail
 * reply must render on the Contact record's timeline and count toward
 * `getPersonTimeline`'s true per-type totals (`countsByType`), exactly like
 * every other real activity type there.
 *
 * queries.ts imports `@/db` (throws at import time without a live
 * DATABASE_URL — see src/db/index.ts), so it is never imported directly
 * from a unit test (same convention as every other DB-touching module in
 * this repo — see tests/unit/accountTypeFilter.test.ts's doc comment).
 * Reading the source as text to pin the array's contents is the same
 * technique tests/unit/drizzleJournal.test.ts and
 * tests/unit/migrationsEnableRls.test.ts already use for a file that can't
 * be safely imported/executed in a test process.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { ALL_TASK_ACTIVITY_TYPES } from "@/lib/tasks/taskActivityBody";

const source = readFileSync("src/lib/activity/queries.ts", "utf8");

function extractTimelineActivityTypes(): string[] {
  const match = source.match(/export const TIMELINE_ACTIVITY_TYPES = \[([\s\S]*?)\] as const;/);
  assert.ok(match, "could not find TIMELINE_ACTIVITY_TYPES array literal in queries.ts");
  return [...match![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

test("TIMELINE_ACTIVITY_TYPES includes reply_received (synced Gmail reply)", () => {
  const types = extractTimelineActivityTypes();
  assert.ok(types.includes("reply_received"), `expected reply_received among ${types.join(", ")}`);
});

test("TIMELINE_ACTIVITY_TYPES still includes every pre-existing type (no accidental removal)", () => {
  const types = extractTimelineActivityTypes();
  for (const type of [
    "note",
    "email_sent",
    "hunter_lookup",
    "status_change",
    "meeting_logged",
    "call",
    "discarded",
    "status_backfill",
    "task_updated",
    "task_completed",
    "task_reopened",
  ]) {
    assert.ok(types.includes(type), `expected pre-existing type "${type}" to still be present`);
  }
});

test("TIMELINE_ACTIVITY_TYPES includes every task activity type, so a task's creation renders and counts", () => {
  const types = extractTimelineActivityTypes();
  for (const type of ALL_TASK_ACTIVITY_TYPES) {
    assert.ok(types.includes(type), `expected ${type} among ${types.join(", ")}`);
  }
});
