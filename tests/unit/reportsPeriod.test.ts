/**
 * Unit tests for src/lib/reports/period.ts — owner-reporting's period filter
 * (semana/mes/trimestre), Argentina calendar boundaries built on
 * argentinaInstantBoundary (src/lib/tasks/argentinaDate.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveReportPeriod, reportPeriodRange } from "@/lib/reports/period";

test("resolveReportPeriod defaults to 'month' for anything unrecognized, including undefined", () => {
  assert.equal(resolveReportPeriod(undefined), "month");
  assert.equal(resolveReportPeriod("bogus"), "month");
  assert.equal(resolveReportPeriod("week"), "week");
  assert.equal(resolveReportPeriod("quarter"), "quarter");
});

test("reportPeriodRange 'month' spans the whole ART calendar month, clamped to now", () => {
  const now = new Date("2026-09-30T14:00:00Z"); // 11:00 ART, 30th
  const range = reportPeriodRange("month", now);
  assert.equal(range.fromIso, "2026-09-01T03:00:00.000Z");
  assert.equal(range.toIso, now.toISOString());
  assert.equal(range.fromDate, "2026-09-01");
  assert.equal(range.toDateExclusive, "2026-10-01");
  assert.equal(range.label, "1–30 sep 2026");
});

test("reportPeriodRange 'month' mid-month: the label still shows the full calendar month", () => {
  const now = new Date("2026-09-15T14:00:00Z");
  const range = reportPeriodRange("month", now);
  assert.equal(range.label, "1–30 sep 2026");
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

test("reportPeriodRange 'quarter' spans the current ART calendar quarter (Jan/Apr/Jul/Oct start)", () => {
  const now = new Date("2026-09-30T14:00:00Z"); // Q3 (Jul-Sep)
  const range = reportPeriodRange("quarter", now);
  assert.equal(range.fromDate, "2026-07-01");
  assert.equal(range.toDateExclusive, "2026-10-01");
});

test("reportPeriodRange 'quarter' crossing a year boundary (Q4 starts October)", () => {
  const now = new Date("2026-12-15T14:00:00Z");
  const range = reportPeriodRange("quarter", now);
  assert.equal(range.fromDate, "2026-10-01");
  assert.equal(range.toDateExclusive, "2027-01-01");
});

test("reportPeriodRange never mutates across repeated calls with the same 'now' (pure)", () => {
  const now = new Date("2026-09-30T14:00:00Z");
  const a = reportPeriodRange("month", now);
  const b = reportPeriodRange("month", now);
  assert.deepEqual(a, b);
  assert.equal(now.toISOString(), "2026-09-30T14:00:00.000Z", "must not mutate the passed-in Date");
});
