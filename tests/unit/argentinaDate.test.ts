/**
 * Unit tests for src/lib/tasks/argentinaDate.ts — the fixed UTC-3 calendar-day
 * arithmetic behind the task digest's "today"/"yesterday"/"atrasadas"
 * buckets. Boundary case: a task due 23:30 ART yesterday is 02:30 UTC
 * *today* — it must still classify as "ayer", not "hoy".
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDaysToDateString,
  argentinaCalendarDate,
  argentinaDayBoundaries,
  formatTaskDueDate,
  taskDueDate,
} from "@/lib/tasks/argentinaDate";

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

test("argentinaDayBoundaries derives today/yesterday and the UTC cutoffs from due_at's own calendar-date encoding (00:00 UTC), not ART midnight", () => {
  const now = new Date("2026-09-29T11:30:00Z"); // cron fire time, 08:30 ART
  const b = argentinaDayBoundaries(now);
  assert.equal(b.today, "2026-09-29");
  assert.equal(b.yesterday, "2026-09-28");
  assert.equal(b.todayStartUtc.toISOString(), "2026-09-29T00:00:00.000Z");
  // Bug fixed here: this used to be ART midnight tomorrow (03:00 UTC), which
  // is AFTER a due-tomorrow task's actual due_at (tomorrow 00:00 UTC) and so
  // wrongly counted it as due today/overdue.
  assert.equal(b.tomorrowStartUtc.toISOString(), "2026-09-30T00:00:00.000Z");
});

test("a task due 23:30 ART yesterday (02:30 UTC today) is before the cutoff, i.e. counted as 'ayer'", () => {
  const now = new Date("2026-09-29T11:30:00Z");
  const b = argentinaDayBoundaries(now);
  const dueAt = new Date("2026-09-29T02:30:00Z");
  assert.ok(dueAt < b.tomorrowStartUtc, "dueAt must be before tomorrow's ART midnight");
  assert.equal(argentinaCalendarDate(dueAt), b.yesterday);
});

/**
 * `taskDueDate` reads `due_at`'s own calendar date (UTC fields, no ART
 * shift) — the production bug (2026-09-29 digest dry run) was reading it
 * through `argentinaCalendarDate` instead, which shifts a due-today task
 * (00:00 UTC) back to "yesterday" and a due-yesterday task to "before
 * yesterday" (atrasada).
 */
test("taskDueDate reads due_at's stored calendar date directly, without the ART instant shift", () => {
  assert.equal(taskDueDate(new Date("2026-09-29T00:00:00Z")), "2026-09-29");
  assert.equal(taskDueDate(new Date("2026-09-28T00:00:00Z")), "2026-09-28");
});

test("formatTaskDueDate displays the stored UTC calendar date regardless of the caller's timezone", () => {
  assert.equal(formatTaskDueDate(new Date("2026-09-29T00:00:00Z")), "29 sep");
  assert.equal(formatTaskDueDate(new Date("2026-09-28T00:00:00Z")), "28 sep");
});

/**
 * Exact production values from the 2026-09-29 digest dry run: a task due
 * today (2026-09-29T00:00:00Z) and a task due yesterday
 * (2026-09-28T00:00:00Z), checked at three "now" instants spanning the ART
 * calendar-day boundary. A task due tomorrow (2026-09-30T00:00:00Z) must
 * never fall inside "today or earlier" while it is still the 29th in ART.
 */
test("production values: due today/yesterday/tomorrow classify correctly across the 08:30/23:30/00:10 ART boundary", () => {
  const dueToday = new Date("2026-09-29T00:00:00Z");
  const dueYesterday = new Date("2026-09-28T00:00:00Z");
  const dueTomorrow = new Date("2026-09-30T00:00:00Z");

  const nowMorning = new Date("2026-09-29T11:30:00Z"); // 08:30 ART, 29th
  const nowLateEvening = new Date("2026-09-30T02:30:00Z"); // 23:30 ART, still 29th
  const nowJustAfterMidnight = new Date("2026-09-30T03:10:00Z"); // 00:10 ART, 30th

  for (const now of [nowMorning, nowLateEvening]) {
    const b = argentinaDayBoundaries(now);
    assert.equal(b.today, "2026-09-29", `today for ${now.toISOString()}`);
    assert.equal(taskDueDate(dueToday), b.today);
    assert.equal(taskDueDate(dueYesterday), b.yesterday);
    assert.ok(
      dueTomorrow.getTime() >= b.tomorrowStartUtc.getTime(),
      "a task due tomorrow must never be before tomorrowStartUtc while it's still the 29th in ART",
    );
  }

  // Once it's actually 00:10 ART on the 30th, "today" has rolled over — the
  // task previously "due tomorrow" is now legitimately due today.
  const bAfterRollover = argentinaDayBoundaries(nowJustAfterMidnight);
  assert.equal(bAfterRollover.today, "2026-09-30");
  assert.equal(taskDueDate(dueTomorrow), bAfterRollover.today);
});
