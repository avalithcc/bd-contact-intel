/**
 * The range calendar's pure logic (src/lib/reports/rangeCalendar.ts): the grid (Monday first), which days can be picked
 * (never the future, never more than 400 days from the first click), how two clicks become a range, keyboard movement, labels.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { dayLabel, dayState, describeRange, isDayDisabled, monthCells, moveDay, pickDay, shiftMonth } from "@/lib/reports/rangeCalendar";

const TODAY = "2026-10-19"; // Monday

test("monthCells starts the weeks on Monday and pads with nulls", () => {
  const oct = monthCells(2026, 10); // 1 Oct 2026 is a Thursday
  assert.deepEqual(oct.slice(0, 5), [null, null, null, "2026-10-01", "2026-10-02"]);
  assert.equal(oct.filter(Boolean).length, 31);
  assert.equal(oct.length % 7, 0);
  const feb = monthCells(2026, 2); // 1 Feb 2026 is a Sunday
  assert.equal(feb.indexOf("2026-02-01"), 6);
  assert.equal(feb.filter(Boolean).length, 28);
});

test("shiftMonth crosses the year boundary both ways", () => {
  assert.deepEqual(shiftMonth({ y: 2026, m: 1 }, -1), { y: 2025, m: 12 });
  assert.deepEqual(shiftMonth({ y: 2026, m: 12 }, 1), { y: 2027, m: 1 });
});

test("future days are disabled, today is not", () => {
  assert.equal(isDayDisabled("2026-10-19", TODAY, null), false);
  assert.equal(isDayDisabled("2026-10-20", TODAY, null), true);
});

test("after the first click, days more than 400 days away are disabled in both directions", () => {
  assert.equal(isDayDisabled("2025-09-14", TODAY, "2026-10-18"), false, "exactly 400 days before");
  assert.equal(isDayDisabled("2025-09-12", TODAY, "2026-10-18"), true, "401 days before");
  assert.equal(isDayDisabled("2026-10-19", TODAY, "2025-09-15"), false, "399 days after");
});

test("pickDay: first click starts, second completes (ordered either way), a third starts over", () => {
  const first = pickDay({ start: null, end: null }, "2026-10-10");
  assert.deepEqual(first, { start: "2026-10-10", end: null });
  assert.deepEqual(pickDay(first, "2026-10-15"), { start: "2026-10-10", end: "2026-10-15" });
  assert.deepEqual(pickDay(first, "2026-10-01"), { start: "2026-10-01", end: "2026-10-10" });
  assert.deepEqual(pickDay(first, "2026-10-10"), { start: "2026-10-10", end: "2026-10-10" }, "one day is a valid range");
  assert.deepEqual(pickDay({ start: "2026-10-01", end: "2026-10-05" }, "2026-10-08"), { start: "2026-10-08", end: null });
});

test("pickDay does not mutate its input and gives the same answer twice", () => {
  const input = Object.freeze({ start: "2026-10-10", end: null });
  assert.deepEqual(pickDay(input, "2026-10-12"), pickDay(input, "2026-10-12"));
});

test("moveDay: arrows move a day or a week, Page keys a month, never into the future", () => {
  assert.equal(moveDay("2026-10-10", "ArrowLeft", TODAY), "2026-10-09");
  assert.equal(moveDay("2026-10-10", "ArrowRight", TODAY), "2026-10-11");
  assert.equal(moveDay("2026-10-10", "ArrowUp", TODAY), "2026-10-03");
  assert.equal(moveDay("2026-10-10", "ArrowDown", TODAY), "2026-10-17");
  assert.equal(moveDay("2026-10-17", "ArrowDown", TODAY), "2026-10-19", "clamped to today");
  assert.equal(moveDay("2026-10-19", "ArrowRight", TODAY), "2026-10-19");
  assert.equal(moveDay("2026-10-10", "PageUp", TODAY), "2026-09-10");
  assert.equal(moveDay("2026-03-31", "PageUp", TODAY), "2026-02-28", "the day is clamped to the shorter month");
  assert.equal(moveDay("2026-09-25", "PageDown", TODAY), "2026-10-19");
});

test("dayState marks the ends, the days between and the hover preview", () => {
  const sel = { start: "2026-10-05", end: "2026-10-08" };
  assert.equal(dayState("2026-10-05", sel, null), "start");
  assert.equal(dayState("2026-10-08", sel, null), "end");
  assert.equal(dayState("2026-10-06", sel, null), "in");
  assert.equal(dayState("2026-10-09", sel, null), null);
  assert.equal(dayState("2026-10-05", { start: "2026-10-05", end: "2026-10-05" }, null), "single");
  const open = { start: "2026-10-05", end: null };
  assert.equal(dayState("2026-10-07", open, "2026-10-09"), "preview");
  assert.equal(dayState("2026-10-09", open, "2026-10-09"), "end");
  assert.equal(dayState("2026-10-03", open, "2026-10-01"), null);
});

test("labels are Spanish", () => {
  assert.equal(describeRange("2026-10-01", "2026-10-19"), "1 oct – 19 oct 2026");
  assert.equal(describeRange("2025-12-30", "2026-01-02"), "30 dic 2025 – 2 ene 2026");
  assert.equal(describeRange("2026-10-01", null), "1 oct – …");
  assert.equal(dayLabel("2026-10-19"), "lunes 19 de octubre de 2026");
});
