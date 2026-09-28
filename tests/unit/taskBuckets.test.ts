/**
 * Unit tests for src/lib/tasks/taskBuckets.ts — the pure vencidas/hoy/
 * próximas split behind /tasks (bug: "Todas abiertas" silently dropped every
 * overdue task instead of showing it as overdue, because the page hardcoded
 * `overdueTasks = []` for any view other than "mine" — see page.tsx history).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTaskBuckets, dueBucketOf } from "@/lib/tasks/taskBuckets";

const NOW = new Date("2026-09-28T12:00:00Z");

test("dueBucketOf classifies past/today/tomorrow/later dates relative to now", () => {
  assert.equal(dueBucketOf(null, NOW), null);
  assert.equal(dueBucketOf(new Date("2026-09-20T00:00:00Z"), NOW), "overdue");
  assert.equal(dueBucketOf(new Date("2026-09-28T06:00:00Z"), NOW), "today");
  assert.equal(dueBucketOf(new Date("2026-09-29T12:00:00Z"), NOW), "tomorrow");
  assert.equal(dueBucketOf(new Date("2026-10-05T00:00:00Z"), NOW), "week");
});

test("buildTaskBuckets puts every overdue task in the overdue bucket regardless of view", () => {
  // Same shape "Todas abiertas" (getAllOpenTasks) produces: an overdue task
  // for a TEAMMATE, not the current BD.
  const overdueTeammateTask = { id: "t1", dueAt: new Date("2026-09-20T00:00:00Z") };
  const todayTask = { id: "t2", dueAt: new Date("2026-09-28T06:00:00Z") };
  const openTasks = [overdueTeammateTask, todayTask];
  // The fix: the overdue set must come from a real overdue query for the
  // active view (getOverdueTasks for "mine", getAllOverdueTasks for "all"),
  // never a hardcoded `[]`.
  const overdueTasks = [overdueTeammateTask];

  const buckets = buildTaskBuckets(openTasks, overdueTasks, NOW);

  assert.deepEqual(buckets.overdueTasks, [overdueTeammateTask]);
  assert.deepEqual(buckets.todayTasks, [todayTask]);
  assert.deepEqual(buckets.upcomingTasks, []);
});

test("buildTaskBuckets never double-counts an overdue task into today/upcoming", () => {
  const overdue = { id: "t1", dueAt: new Date("2026-09-01T00:00:00Z") };
  const buckets = buildTaskBuckets([overdue], [overdue], NOW);
  assert.equal(buckets.todayTasks.length, 0);
  assert.equal(buckets.upcomingTasks.length, 0);
  assert.deepEqual(buckets.overdueTasks, [overdue]);
});

test("buildTaskBuckets clones its inputs into new arrays (pure planner, never mutates)", () => {
  const openTasks = [{ id: "t1", dueAt: null }];
  const overdueTasks: typeof openTasks = [];
  const result1 = buildTaskBuckets(openTasks, overdueTasks, NOW);
  const result2 = buildTaskBuckets(openTasks, overdueTasks, NOW);
  assert.deepEqual(result1, result2);
  assert.notEqual(result1.upcomingTasks, openTasks);
});
