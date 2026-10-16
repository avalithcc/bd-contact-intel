import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canTransition,
  formatSendAt,
  isLocked,
  MAX_PENDING,
  planSchedule,
  wallTimeToInstant,
  type ScheduledStatus,
} from "@/lib/scheduledEmail/plan";

const now = new Date("2026-10-16T17:00:00.000Z");
const at = (ms: number) => new Date(now.getTime() + ms);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

test("limits: under 5 minutes is too soon, 5 minutes to 30 days is fine, beyond is too far", () => {
  assert.deepEqual(planSchedule({ sendAt: at(5 * MIN - 1), now, pendingCount: 0 }), { ok: false, reason: "schedule_too_soon" });
  assert.deepEqual(planSchedule({ sendAt: at(-DAY), now, pendingCount: 0 }), { ok: false, reason: "schedule_too_soon" });
  assert.equal(planSchedule({ sendAt: at(5 * MIN), now, pendingCount: 0 }).ok, true);
  assert.equal(planSchedule({ sendAt: at(30 * DAY), now, pendingCount: 0 }).ok, true);
  assert.deepEqual(planSchedule({ sendAt: at(30 * DAY + 1), now, pendingCount: 0 }), { ok: false, reason: "schedule_too_far" });
  assert.deepEqual(planSchedule({ sendAt: new Date("nope"), now, pendingCount: 0 }), { ok: false, reason: "schedule_too_soon" });
});

test("the cap is 50 pending per BD: the 51st is refused", () => {
  assert.equal(MAX_PENDING, 50);
  assert.equal(planSchedule({ sendAt: at(10 * MIN), now, pendingCount: 49 }).ok, true);
  assert.deepEqual(planSchedule({ sendAt: at(10 * MIN), now, pendingCount: 50 }), { ok: false, reason: "schedule_cap_reached" });
});

test("the planner never mutates its input and gives the same answer twice", () => {
  const input = Object.freeze({ sendAt: at(10 * MIN), now, pendingCount: 3 });
  const before = input.sendAt.getTime();
  const first = planSchedule(input);
  assert.deepEqual(planSchedule(input), first);
  assert.equal(input.sendAt.getTime(), before);
});

test("a scheduled row locks 2 minutes before its time; held and failed rows are never locked", () => {
  const row = (status: ScheduledStatus, ms: number) => ({ status, sendAt: at(ms) });
  assert.equal(isLocked(row("scheduled", 2 * MIN + 1), now), false);
  assert.equal(isLocked(row("scheduled", 2 * MIN), now), true);
  assert.equal(isLocked(row("scheduled", -MIN), now), true);
  assert.equal(isLocked(row("on_hold", -MIN), now), false);
  assert.equal(isLocked(row("failed", -MIN), now), false);
  assert.equal(isLocked(row("sending", 10 * MIN), now), true);
  assert.equal(isLocked(row("sent", 10 * MIN), now), true);
});

test("state transitions: a failed or held row never goes back to sending by itself", () => {
  assert.equal(canTransition("scheduled", "sending"), true);
  assert.equal(canTransition("scheduled", "on_hold"), true);
  assert.equal(canTransition("sending", "sent"), true);
  assert.equal(canTransition("sending", "failed"), true);
  assert.equal(canTransition("failed", "sending"), false);
  assert.equal(canTransition("on_hold", "sending"), false);
  assert.equal(canTransition("failed", "scheduled"), true);
  assert.equal(canTransition("sent", "scheduled"), false);
  assert.equal(canTransition("cancelled", "scheduled"), false);
  assert.equal(canTransition("sending", "scheduled"), false);
});

test("Argentina wall time is UTC-3; Miami follows daylight saving", () => {
  assert.equal(wallTimeToInstant("2026-10-19", "10:00", "argentina")?.toISOString(), "2026-10-19T13:00:00.000Z");
  assert.equal(wallTimeToInstant("2026-10-19", "09:00", "miami")?.toISOString(), "2026-10-19T13:00:00.000Z");
  assert.equal(wallTimeToInstant("2026-12-14", "09:00", "miami")?.toISOString(), "2026-12-14T14:00:00.000Z");
  assert.equal(wallTimeToInstant("2026-13-40", "09:00", "miami"), null);
  assert.equal(wallTimeToInstant("2026-10-19", "", "argentina"), null);
});

test("the same instant is shown in Argentina and in Miami", () => {
  const instant = new Date("2026-10-19T13:00:00.000Z");
  assert.match(formatSendAt(instant, "argentina"), /19 oct.*10:00/);
  assert.match(formatSendAt(instant, "miami"), /19 oct.*9:00|19 oct.*09:00/);
});
