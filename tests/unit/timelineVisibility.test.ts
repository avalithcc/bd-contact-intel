/**
 * Unit tests for src/lib/activity/timelineVisibility.ts (task 10.1;
 * admin-access-audit spec "Non-admins cannot read other BDs' conversation
 * content"). Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isTimelineEntryVisible } from "@/lib/activity/timelineVisibility";

test("a note is visible to every viewer regardless of actor", () => {
  assert.equal(isTimelineEntryVisible({ type: "note", actorBdId: "bd-a" }, "bd-b"), true);
});

test("an email_sent by the viewer themselves is visible to the viewer", () => {
  assert.equal(isTimelineEntryVisible({ type: "email_sent", actorBdId: "bd-a" }, "bd-a"), true);
});

test("an email_sent by another BD is hidden from a different viewer", () => {
  assert.equal(isTimelineEntryVisible({ type: "email_sent", actorBdId: "bd-a" }, "bd-b"), false);
});

test("an email_sent with no actor (system-derived) is visible to every viewer", () => {
  assert.equal(isTimelineEntryVisible({ type: "email_sent", actorBdId: null }, "bd-b"), true);
});

test("meeting_logged, discarded, status_change, status_backfill, hunter_lookup are always visible", () => {
  for (const type of ["meeting_logged", "discarded", "status_change", "status_backfill", "hunter_lookup"]) {
    assert.equal(isTimelineEntryVisible({ type, actorBdId: "bd-a" }, "bd-b"), true, type);
  }
});
