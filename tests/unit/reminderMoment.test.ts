import assert from "node:assert/strict";
import { test } from "node:test";
import { reminderMoment } from "@/lib/sequences/reminderMoment";
import { reminderReleaseAt, DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";

const NOW = new Date("2026-10-15T14:00:00Z");

test("no scheduledFor, no moment", () => {
  assert.equal(reminderMoment({ scheduledFor: null }, NOW), null);
});

test("phase follows the lead time: overdue, locked under 2 minutes, future", () => {
  assert.deepEqual(reminderMoment({ scheduledFor: new Date(NOW.getTime() - 1) }, NOW)?.phase, "overdue");
  assert.equal(reminderMoment({ scheduledFor: new Date(NOW.getTime() + 60_000) }, NOW)?.phase, "locked");
  assert.equal(reminderMoment({ scheduledFor: new Date(NOW.getTime() + 3 * 60_000) }, NOW)?.phase, "future");
});

test("pins the schedule rule the card date rides on: approved at 14:30 Miami on the due day, reminderReleaseAt is the next 09:00, and reminderMoment reports it as a future instant", () => {
  const approvedAt = new Date("2026-10-15T18:30:00Z"); // 14:30 Miami
  const dueAt = new Date("2026-10-15T13:00:00Z");
  const at = reminderReleaseAt(dueAt, approvedAt, DEFAULT_SCHEDULE)!;
  const m = reminderMoment({ scheduledFor: at }, approvedAt)!;
  assert.equal(m.at.toISOString(), "2026-10-16T13:00:00.000Z"); // 09:00 Miami next day
  assert.equal(m.phase, "future");
});
