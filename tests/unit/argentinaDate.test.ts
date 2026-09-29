/**
 * Unit tests for src/lib/tasks/argentinaDate.ts — the fixed UTC-3 calendar-day
 * arithmetic behind the task digest's "today"/"yesterday"/"atrasadas"
 * buckets. Boundary case: a task due 23:30 ART yesterday is 02:30 UTC
 * *today* — it must still classify as "ayer", not "hoy".
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { addDaysToDateString, argentinaCalendarDate, argentinaDayBoundaries } from "@/lib/tasks/argentinaDate";

test("argentinaCalendarDate converts a UTC instant to its ART calendar date", () => {
  // 2026-09-29T02:30:00Z is 2026-09-28T23:30:00-03:00 in ART.
  assert.equal(argentinaCalendarDate(new Date("2026-09-29T02:30:00Z")), "2026-09-28");
  // 2026-09-29T11:30:00Z (the cron's own fire time, 08:30 ART) is 2026-09-29 ART.
  assert.equal(argentinaCalendarDate(new Date("2026-09-29T11:30:00Z")), "2026-09-29");
  // Right at the ART midnight boundary: 03:00:00Z is 00:00:00 ART, already "today".
  assert.equal(argentinaCalendarDate(new Date("2026-09-29T03:00:00Z")), "2026-09-29");
  assert.equal(argentinaCalendarDate(new Date("2026-09-29T02:59:59.999Z")), "2026-09-28");
});

test("addDaysToDateString adds and subtracts whole calendar days", () => {
  assert.equal(addDaysToDateString("2026-09-29", -1), "2026-09-28");
  assert.equal(addDaysToDateString("2026-09-29", 1), "2026-09-30");
  assert.equal(addDaysToDateString("2026-09-01", -1), "2026-08-31");
});

test("argentinaDayBoundaries derives today/yesterday and the UTC cutoff for 'due by today'", () => {
  const now = new Date("2026-09-29T11:30:00Z"); // cron fire time, 08:30 ART
  const b = argentinaDayBoundaries(now);
  assert.equal(b.today, "2026-09-29");
  assert.equal(b.yesterday, "2026-09-28");
  assert.equal(b.tomorrowStartUtc.toISOString(), "2026-09-30T03:00:00.000Z");
});

test("a task due 23:30 ART yesterday (02:30 UTC today) is before the cutoff, i.e. counted as 'ayer'", () => {
  const now = new Date("2026-09-29T11:30:00Z");
  const b = argentinaDayBoundaries(now);
  const dueAt = new Date("2026-09-29T02:30:00Z");
  assert.ok(dueAt < b.tomorrowStartUtc, "dueAt must be before tomorrow's ART midnight");
  assert.equal(argentinaCalendarDate(dueAt), b.yesterday);
});
