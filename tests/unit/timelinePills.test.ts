/**
 * Unit tests for src/lib/activity/timelinePills.ts (mockup-port fix:
 * contact-record.html:97-106's 8 timeline filter pills — the DB's raw
 * `activity.type` enum must never leak into the pill row; the four
 * migration/internal types (`hunter_lookup`, `status_change`, `discarded`,
 * `status_backfill`) group behind one "Sistema" pill).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TIMELINE_PILL_KEYS,
  TIMELINE_PILL_GROUPS,
  isTimelinePillKey,
  resolveTimelinePillKey,
  sumPillCount,
} from "@/lib/activity/timelinePills";

test("TIMELINE_PILL_KEYS has no LinkedIn or Tareas pill and groups the 4 internal types under system", () => {
  assert.deepEqual([...TIMELINE_PILL_KEYS], ["note", "call", "email_sent", "meeting_logged", "system"]);
  assert.deepEqual(
    [...TIMELINE_PILL_GROUPS.system].sort(),
    ["discarded", "hunter_lookup", "status_backfill", "status_change"].sort(),
  );
});

test("resolveTimelinePillKey accepts a pill key directly", () => {
  assert.equal(resolveTimelinePillKey("note"), "note");
  assert.equal(resolveTimelinePillKey("system"), "system");
});

test("resolveTimelinePillKey maps a legacy raw activity type to its group (deep-link continuity)", () => {
  assert.equal(resolveTimelinePillKey("status_backfill"), "system");
  assert.equal(resolveTimelinePillKey("hunter_lookup"), "system");
  assert.equal(resolveTimelinePillKey("status_change"), "system");
  assert.equal(resolveTimelinePillKey("discarded"), "system");
});

test("resolveTimelinePillKey returns undefined for unknown/empty values", () => {
  assert.equal(resolveTimelinePillKey(undefined), undefined);
  assert.equal(resolveTimelinePillKey(""), undefined);
  assert.equal(resolveTimelinePillKey("bogus"), undefined);
});

test("isTimelinePillKey narrows only the 5 known pill keys", () => {
  assert.equal(isTimelinePillKey("system"), true);
  assert.equal(isTimelinePillKey("status_backfill"), false);
});

test("sumPillCount sums the counts of every type a pill groups", () => {
  const countsByType = { note: 3, hunter_lookup: 2, status_change: 1, discarded: 0, status_backfill: 4 };
  assert.equal(sumPillCount(countsByType, "system"), 7);
  assert.equal(sumPillCount(countsByType, "note"), 3);
  assert.equal(sumPillCount(countsByType, "call"), 0);
});
