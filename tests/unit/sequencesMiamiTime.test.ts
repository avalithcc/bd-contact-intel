import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addCalendarDays,
  miamiCalendarDate,
  miamiWallClockToUtc,
  nextMiamiNineAm,
} from "../../src/lib/sequences/miamiTime";
import { parseSchedule, reminderDueAt, step1DueAt } from "../../src/lib/sequences/schedule";

const iso = (d: Date) => d.toISOString();

test("miamiCalendarDate reads the Miami date, not the UTC date", () => {
  // 23:50 EDT on Oct 14 is already Oct 15 in UTC.
  assert.equal(miamiCalendarDate(new Date("2026-10-15T03:50:00Z")), "2026-10-14");
  assert.equal(miamiCalendarDate(new Date("2026-10-15T04:00:00Z")), "2026-10-15");
});

test("miamiCalendarDate around the fall-back midnight (EDT -> EST)", () => {
  assert.equal(miamiCalendarDate(new Date("2026-11-01T03:59:00Z")), "2026-10-31");
  assert.equal(miamiCalendarDate(new Date("2026-11-01T04:00:00Z")), "2026-11-01");
  // Both 01:30 occurrences belong to Nov 1.
  assert.equal(miamiCalendarDate(new Date("2026-11-01T05:30:00Z")), "2026-11-01");
  assert.equal(miamiCalendarDate(new Date("2026-11-01T06:30:00Z")), "2026-11-01");
  // The day is 25 hours long: 23:59 EST is 04:59Z on Nov 2.
  assert.equal(miamiCalendarDate(new Date("2026-11-02T04:59:00Z")), "2026-11-01");
  assert.equal(miamiCalendarDate(new Date("2026-11-02T05:00:00Z")), "2026-11-02");
});

test("miamiCalendarDate around the spring-forward day", () => {
  assert.equal(miamiCalendarDate(new Date("2026-03-08T04:59:00Z")), "2026-03-07");
  assert.equal(miamiCalendarDate(new Date("2026-03-08T05:00:00Z")), "2026-03-08");
  assert.equal(miamiCalendarDate(new Date("2026-03-09T03:59:00Z")), "2026-03-08");
});

test("addCalendarDays crosses month, year and leap boundaries", () => {
  assert.equal(addCalendarDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addCalendarDays("2026-10-15", 7), "2026-10-22");
});

test("miamiWallClockToUtc: 09:00 is 13:00Z in summer and 14:00Z in winter", () => {
  assert.equal(iso(miamiWallClockToUtc("2026-07-01", 9)), "2026-07-01T13:00:00.000Z");
  assert.equal(iso(miamiWallClockToUtc("2026-01-15", 9)), "2026-01-15T14:00:00.000Z");
});

test("miamiWallClockToUtc on both sides of the spring-forward transition", () => {
  assert.equal(iso(miamiWallClockToUtc("2026-03-07", 9)), "2026-03-07T14:00:00.000Z"); // EST
  assert.equal(iso(miamiWallClockToUtc("2026-03-08", 9)), "2026-03-08T13:00:00.000Z"); // EDT
  assert.equal(iso(miamiWallClockToUtc("2026-03-09", 9)), "2026-03-09T13:00:00.000Z"); // EDT
});

test("miamiWallClockToUtc on both sides of the fall-back transition", () => {
  assert.equal(iso(miamiWallClockToUtc("2026-10-31", 9)), "2026-10-31T13:00:00.000Z"); // EDT
  assert.equal(iso(miamiWallClockToUtc("2026-11-01", 9)), "2026-11-01T14:00:00.000Z"); // EST
  assert.equal(iso(miamiWallClockToUtc("2026-11-02", 9)), "2026-11-02T14:00:00.000Z"); // EST
});

test("miamiWallClockToUtc: a nonexistent local time moves forward past the gap", () => {
  // 02:30 on 2026-03-08 never happens (02:00 jumps to 03:00).
  assert.equal(iso(miamiWallClockToUtc("2026-03-08", 2, 30)), "2026-03-08T07:30:00.000Z");
  // Last valid minute before the gap and first after it.
  assert.equal(iso(miamiWallClockToUtc("2026-03-08", 1, 59)), "2026-03-08T06:59:00.000Z");
  assert.equal(iso(miamiWallClockToUtc("2026-03-08", 3, 0)), "2026-03-08T07:00:00.000Z");
});

test("miamiWallClockToUtc: an ambiguous local time resolves to the first occurrence", () => {
  // 01:30 on 2026-11-01 happens twice; the earlier one is EDT (05:30Z).
  assert.equal(iso(miamiWallClockToUtc("2026-11-01", 1, 30)), "2026-11-01T05:30:00.000Z");
  assert.equal(iso(miamiWallClockToUtc("2026-11-01", 2, 0)), "2026-11-01T07:00:00.000Z");
});

test("nextMiamiNineAm: the day after approval at 09:00 Miami", () => {
  // 2026-10-14 16:30 EDT
  assert.equal(iso(nextMiamiNineAm(new Date("2026-10-14T20:30:00Z"))), "2026-10-15T13:00:00.000Z");
});

test("nextMiamiNineAm: approval at 23:50 Miami still schedules the next calendar day", () => {
  // 2026-10-14 23:50 EDT is 2026-10-15 03:50Z; the answer must still be Oct 15, not Oct 16.
  assert.equal(iso(nextMiamiNineAm(new Date("2026-10-15T03:50:00Z"))), "2026-10-15T13:00:00.000Z");
});

test("nextMiamiNineAm: approval on the day DST ends gives 14:00Z, not 13:00Z", () => {
  assert.equal(iso(nextMiamiNineAm(new Date("2026-11-01T17:00:00Z"))), "2026-11-02T14:00:00.000Z");
});

test("nextMiamiNineAm across both 2026 transitions", () => {
  // Approved the evening before spring-forward: next 09:00 is already EDT.
  assert.equal(iso(nextMiamiNineAm(new Date("2026-03-08T00:00:00Z"))), "2026-03-08T13:00:00.000Z");
  // Approved on the spring-forward day itself.
  assert.equal(iso(nextMiamiNineAm(new Date("2026-03-08T15:00:00Z"))), "2026-03-09T13:00:00.000Z");
  // Approved on the eve of fall-back: next 09:00 is already EST.
  assert.equal(iso(nextMiamiNineAm(new Date("2026-10-31T20:00:00Z"))), "2026-11-01T14:00:00.000Z");
});

test("step1DueAt is the next Miami 09:00 after approval", () => {
  assert.equal(iso(step1DueAt(new Date("2026-11-01T17:00:00Z"))), "2026-11-02T14:00:00.000Z");
});

test("reminderDueAt is 7 Miami days after the actual send, at 09:00 Miami", () => {
  // Sent 2026-10-15 09:02 EDT -> due 2026-10-22.
  assert.equal(iso(reminderDueAt(new Date("2026-10-15T13:02:00Z"))), "2026-10-22T13:00:00.000Z");
});

test("reminderDueAt: a cap-delayed step 1 pushes the reminder", () => {
  assert.equal(iso(reminderDueAt(new Date("2026-10-16T13:02:00Z"))), "2026-10-23T13:00:00.000Z");
});

test("reminderDueAt keeps 09:00 Miami when the 7 days cross a DST change", () => {
  // Sent Oct 30 (EDT); the reminder lands on Nov 6 (EST) -> 14:00Z.
  assert.equal(iso(reminderDueAt(new Date("2026-10-30T13:02:00Z"))), "2026-11-06T14:00:00.000Z");
});

test("parseSchedule falls back to the spec values", () => {
  const defaults = {
    step1: { hour: 9, timezone: "America/New_York", offsetDays: 1 },
    step2: { afterDays: 7 },
  };
  assert.deepEqual(parseSchedule(null), defaults);
  assert.deepEqual(parseSchedule(undefined), defaults);
  assert.deepEqual(parseSchedule({}), defaults);
  assert.deepEqual(parseSchedule("nope"), defaults);
  assert.deepEqual(parseSchedule({ step1: { hour: "x", offsetDays: -2 }, step2: { afterDays: 0 } }), defaults);
  // A timezone other than the supported one is not honoured.
  assert.deepEqual(parseSchedule({ step1: { timezone: "Europe/Madrid" } }), defaults);
});

test("parseSchedule keeps valid overrides", () => {
  assert.deepEqual(parseSchedule({ step1: { hour: 10, offsetDays: 2 }, step2: { afterDays: 5 } }), {
    step1: { hour: 10, timezone: "America/New_York", offsetDays: 2 },
    step2: { afterDays: 5 },
  });
});

test("schedule functions honour a parsed schedule", () => {
  const s = parseSchedule({ step1: { hour: 10, offsetDays: 2 }, step2: { afterDays: 5 } });
  assert.equal(iso(step1DueAt(new Date("2026-10-14T20:30:00Z"), s)), "2026-10-16T14:00:00.000Z");
  assert.equal(iso(reminderDueAt(new Date("2026-10-15T13:02:00Z"), s)), "2026-10-20T14:00:00.000Z");
});
