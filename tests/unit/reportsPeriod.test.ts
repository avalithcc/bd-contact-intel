/**
 * Unit tests for src/lib/reports/period.ts — owner-reporting's period filter
 * (semana/mes/mes pasado/personalizado), Argentina calendar boundaries built on
 * argentinaInstantBoundary (src/lib/tasks/argentinaDate.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveReportPeriod, reportPeriodRange } from "@/lib/reports/period";

test("resolveReportPeriod defaults to 'month' for anything unrecognized, including undefined", () => {
  assert.equal(resolveReportPeriod(undefined), "month");
  assert.equal(resolveReportPeriod("bogus"), "month");
  assert.equal(resolveReportPeriod("week"), "week");
  for (const removed of ["quarter", "last_week", "last_quarter"]) assert.equal(resolveReportPeriod(removed), "month", `${removed} is gone: an old URL falls back to the month`);
  for (const kept of ["last_month", "custom"]) assert.equal(resolveReportPeriod(kept), kept);
});

test("reportPeriodRange 'month' runs from the 1st to now", () => {
  const now = new Date("2026-09-30T14:00:00Z"); // 11:00 ART, 30th
  const range = reportPeriodRange("month", now);
  assert.equal(range.fromIso, "2026-09-01T03:00:00.000Z");
  assert.equal(range.toIso, now.toISOString());
  assert.equal(range.fromDate, "2026-09-01");
  assert.equal(range.toDateExclusive, "2026-10-01");
  assert.equal(range.label, "1 – 30 sep");
  assert.equal(range.lastDate, "2026-09-30");
});

test("reportPeriodRange 'month' mid-month: the label ends today, not at the end of the month", () => {
  const now = new Date("2026-09-15T14:00:00Z");
  const range = reportPeriodRange("month", now);
  assert.equal(range.label, "1 – 15 sep");
  assert.equal(range.toIso, now.toISOString(), "the query cutoff never includes not-yet-happened days");
});

test("reportPeriodRange 'week' starts on the ART Monday of the current week", () => {
  // 2026-09-30 is a Wednesday; the ART Monday is 2026-09-28.
  const now = new Date("2026-09-30T14:00:00Z");
  const range = reportPeriodRange("week", now);
  assert.equal(range.fromIso, "2026-09-28T03:00:00.000Z");
  assert.equal(range.fromDate, "2026-09-28");
});

test("reportPeriodRange 'week' when today itself is Monday starts on today, not the previous Monday", () => {
  const now = new Date("2026-09-28T14:00:00Z"); // Monday
  const range = reportPeriodRange("week", now);
  assert.equal(range.fromDate, "2026-09-28");
});

test("reportPeriodRange never mutates across repeated calls with the same 'now' (pure)", () => {
  const now = new Date("2026-09-30T14:00:00Z");
  const a = reportPeriodRange("month", now);
  const b = reportPeriodRange("month", now);
  assert.deepEqual(a, b);
  assert.equal(now.toISOString(), "2026-09-30T14:00:00.000Z", "must not mutate the passed-in Date");
});
