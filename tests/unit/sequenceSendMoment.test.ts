/**
 * Which instant a Sequence approval stores in `scheduled_for`, by the BD's choice. The Miami 9:00 floor applies to EVERY
 * mode (owner decision 2026-10-19): "now" before the floor waits for it, a chosen time before it is refused.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { capOutlook, resolveSequenceSend } from "@/lib/sequences/sendMoment";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";

const AFTER_FLOOR = new Date("2026-10-19T14:42:00Z"); // 10:42 Miami (EDT)
const BEFORE_FLOOR = new Date("2026-10-19T11:30:00Z"); // 07:30 Miami, 08:30 ART
const at = (now: Date, date: string, time: string) => resolveSequenceSend({ kind: "at", date, time }, { now, schedule: DEFAULT_SCHEDULE });

test("cadence keeps today's behavior: next Miami day 9:00, never immediate", () => {
  const r = resolveSequenceSend({ kind: "cadence" }, { now: AFTER_FLOOR, schedule: DEFAULT_SCHEDULE });
  assert.deepEqual(r, { ok: true, scheduledFor: new Date("2026-10-20T13:00:00Z"), immediate: false, waitsForFloor: false });
});

test("now after the floor is the instant itself and asks for an immediate release attempt", () => {
  const r = resolveSequenceSend({ kind: "now" }, { now: AFTER_FLOOR, schedule: DEFAULT_SCHEDULE });
  assert.deepEqual(r, { ok: true, scheduledFor: AFTER_FLOOR, immediate: true, waitsForFloor: false });
});

test("now before 9:00 Miami waits for the floor of the same Miami day, with no immediate attempt", () => {
  const r = resolveSequenceSend({ kind: "now" }, { now: BEFORE_FLOOR, schedule: DEFAULT_SCHEDULE });
  assert.deepEqual(r, { ok: true, scheduledFor: new Date("2026-10-19T13:00:00Z"), immediate: false, waitsForFloor: true });
});

test("a chosen time is converted from Argentina wall clock and stored as is", () => {
  const r = at(AFTER_FLOOR, "2026-10-22", "10:00"); // 13:00 UTC = 09:00 Miami
  assert.deepEqual(r, { ok: true, scheduledFor: new Date("2026-10-22T13:00:00Z"), immediate: false, waitsForFloor: false });
});

test("a chosen time before 9:00 Miami is refused, never silently moved", () => {
  assert.deepEqual(at(AFTER_FLOOR, "2026-10-22", "09:45"), { ok: false, reason: "before_floor" });
});

test("a chosen time must be at least 5 minutes ahead and at most 30 days", () => {
  assert.deepEqual(at(AFTER_FLOOR, "2026-10-19", "11:45"), { ok: false, reason: "too_soon" });
  assert.deepEqual(at(AFTER_FLOOR, "2026-12-20", "12:00"), { ok: false, reason: "too_far" });
});

test("malformed input is refused", () => {
  assert.deepEqual(at(AFTER_FLOOR, "2026-13-40", "10:00"), { ok: false, reason: "invalid_time" });
  assert.deepEqual(at(AFTER_FLOOR, "2026-10-22", "25:00"), { ok: false, reason: "invalid_time" });
  assert.deepEqual(at(AFTER_FLOOR, "tomorrow", "10:00"), { ok: false, reason: "invalid_time" });
});

test("capOutlook splits a batch into what leaves now and what waits for the next slot", () => {
  assert.deepEqual(capOutlook({ count: 7, cap: 5, sentToday: 0 }), { now: 5, deferred: 2 });
  assert.deepEqual(capOutlook({ count: 3, cap: 5, sentToday: 4 }), { now: 1, deferred: 2 });
  assert.deepEqual(capOutlook({ count: 2, cap: 5, sentToday: 9 }), { now: 0, deferred: 2 });
  assert.deepEqual(capOutlook({ count: 2, cap: 5, sentToday: 0 }), { now: 2, deferred: 0 });
});
