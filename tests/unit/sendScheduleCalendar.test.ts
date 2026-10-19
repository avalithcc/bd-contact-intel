/**
 * Pieces of the report range calendar that the single-day schedule calendar shares (send-now-or-schedule): month helpers and
 * a day grid bounded by a minimum and a maximum day instead of "not after today".
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isDayOutside, monthIndex, monthOf, moveDayWithin } from "@/lib/reports/rangeCalendar";

test("monthOf and monthIndex read a day's month and order months", () => {
  assert.deepEqual(monthOf("2026-10-19"), { y: 2026, m: 10 });
  assert.ok(monthIndex({ y: 2026, m: 12 }) < monthIndex({ y: 2027, m: 1 }));
});

test("isDayOutside disables days before the minimum and after the maximum", () => {
  assert.equal(isDayOutside("2026-10-18", "2026-10-19", "2026-11-18"), true);
  assert.equal(isDayOutside("2026-10-19", "2026-10-19", "2026-11-18"), false);
  assert.equal(isDayOutside("2026-11-18", "2026-10-19", "2026-11-18"), false);
  assert.equal(isDayOutside("2026-11-19", "2026-10-19", "2026-11-18"), true);
});

test("moveDayWithin moves like the keyboard does and stays inside the bounds", () => {
  assert.equal(moveDayWithin("2026-10-20", "ArrowRight", "2026-10-19", "2026-11-18"), "2026-10-21");
  assert.equal(moveDayWithin("2026-10-20", "ArrowUp", "2026-10-19", "2026-11-18"), "2026-10-19");
  assert.equal(moveDayWithin("2026-11-17", "ArrowDown", "2026-10-19", "2026-11-18"), "2026-11-18");
  assert.equal(moveDayWithin("2026-10-20", "PageDown", "2026-10-19", "2026-11-18"), "2026-11-18");
});
