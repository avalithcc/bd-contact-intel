/**
 * Which instant a Sequence approval stores in `scheduled_for`, by the BD's choice. Explicit choices are respected (owner,
 * final 2026-10-19): "now" and a chosen time go out exactly then, even before 9:00 Miami. Only the cadence option keeps
 * the 9:00 Miami floor.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { capOutlook, guardApprovalInput, parseSendChoice, resolveSequenceSend } from "@/lib/sequences/sendMoment";
import { DEFAULT_SCHEDULE, parseSchedule } from "@/lib/sequences/schedule";

const AFTER_FLOOR = new Date("2026-10-19T14:42:00Z"); // 10:42 Miami (EDT)
const BEFORE_FLOOR = new Date("2026-10-19T11:30:00Z"); // 07:30 Miami, 08:30 ART
const at = (now: Date, date: string, time: string) => resolveSequenceSend({ kind: "at", date, time }, { now, schedule: DEFAULT_SCHEDULE });

test("cadence keeps today's behavior: next Miami day 9:00, never immediate", () => {
  const r = resolveSequenceSend({ kind: "cadence" }, { now: AFTER_FLOOR, schedule: DEFAULT_SCHEDULE });
  assert.deepEqual(r, { ok: true, scheduledFor: new Date("2026-10-20T13:00:00Z"), immediate: false });
});

test("cadence never lands before the 9:00 Miami floor, even for a Sequence configured earlier", () => {
  const early = parseSchedule({ step1: { hour: 6, offsetDays: 1 } });
  const r = resolveSequenceSend({ kind: "cadence" }, { now: AFTER_FLOOR, schedule: early });
  assert.deepEqual(r, { ok: true, scheduledFor: new Date("2026-10-20T13:00:00Z"), immediate: false });
});

test("now is the instant itself and asks for an immediate release attempt, before or after 9:00 Miami", () => {
  assert.deepEqual(resolveSequenceSend({ kind: "now" }, { now: AFTER_FLOOR, schedule: DEFAULT_SCHEDULE }), { ok: true, scheduledFor: AFTER_FLOOR, immediate: true });
  assert.deepEqual(resolveSequenceSend({ kind: "now" }, { now: BEFORE_FLOOR, schedule: DEFAULT_SCHEDULE }), { ok: true, scheduledFor: BEFORE_FLOOR, immediate: true });
});

test("a chosen time is converted from Argentina wall clock and respected, even before 9:00 Miami", () => {
  assert.deepEqual(at(AFTER_FLOOR, "2026-10-22", "10:00"), { ok: true, scheduledFor: new Date("2026-10-22T13:00:00Z"), immediate: false });
  // 09:45 ART = 08:45 Miami: before the cadence floor, and still honored.
  assert.deepEqual(at(AFTER_FLOOR, "2026-10-22", "09:45"), { ok: true, scheduledFor: new Date("2026-10-22T12:45:00Z"), immediate: false });
});

test("a chosen time must be at least 5 minutes ahead and at most 30 days", () => {
  assert.deepEqual(at(AFTER_FLOOR, "2026-10-19", "11:45"), { ok: false, reason: "too_soon" });
  assert.deepEqual(at(AFTER_FLOOR, "2026-10-19", "10:00"), { ok: false, reason: "past" });
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

test("parseSendChoice: only an absent choice is the cadence; anything malformed is refused, never guessed", () => {
  assert.deepEqual(parseSendChoice(undefined), { kind: "cadence" });
  assert.deepEqual(parseSendChoice({ kind: "cadence" }), { kind: "cadence" });
  assert.deepEqual(parseSendChoice({ kind: "now" }), { kind: "now" });
  assert.deepEqual(parseSendChoice({ kind: "at", date: "2026-10-22", time: "10:00", extra: 1 }), { kind: "at", date: "2026-10-22", time: "10:00" });
  for (const bad of [null, "now", 3, {}, { kind: "at" }, { kind: "at", date: 1, time: "10:00" }, { kind: "later" }]) assert.equal(parseSendChoice(bad), null);
});

test("guardApprovalInput: a malformed id is not_found, an unreadable choice is invalid_time, otherwise the parsed choice", () => {
  const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);
  const good = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(guardApprovalInput([good], { kind: "now" }, isUuid), { ok: true, choice: { kind: "now" } });
  assert.deepEqual(guardApprovalInput([good], undefined, isUuid), { ok: true, choice: { kind: "cadence" } });
  assert.deepEqual(guardApprovalInput([good, "nope"], { kind: "now" }, isUuid), { ok: false, rejected: [{ memberId: "nope", reason: "not_found" }] });
  assert.deepEqual(guardApprovalInput([good], { kind: "NOW" }, isUuid), { ok: false, rejected: [{ memberId: good, reason: "invalid_time" }] });
});
