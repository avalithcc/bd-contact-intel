/**
 * Unit tests for src/lib/reports/taskCompletions.ts — the pure twin of
 * buildReportPerBdQuery's `rpt_task_completions`/`rpt_tasks_pivot` CTEs
 * (queries.ts's doc comment). Pins the exact "Tareas completadas" rule with
 * plain fixtures, no DB: latest completion per task wins, and a task that
 * is no longer 'done' (reopened) counts nothing at all.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isCompletionCountable, pickLatestCompletion } from "@/lib/reports/taskCompletions";

test("pickLatestCompletion keeps the later completedAt for the same task", () => {
  const first = { taskId: "t1", completedAt: new Date("2026-09-01T00:00:00Z") };
  const second = { taskId: "t1", completedAt: new Date("2026-09-15T00:00:00Z") };
  assert.deepEqual(pickLatestCompletion(null, first), first);
  assert.deepEqual(pickLatestCompletion(first, second), second);
  // Order-independent: an earlier candidate never displaces a later one already picked.
  assert.deepEqual(pickLatestCompletion(second, first), second);
});

test("pickLatestCompletion breaks an exact tie by keeping the incoming candidate (matches SQL's stable DISTINCT ON with no secondary order)", () => {
  const at = new Date("2026-09-15T00:00:00Z");
  const a = { taskId: "t1", completedAt: at };
  const b = { taskId: "t1", completedAt: at };
  assert.equal(pickLatestCompletion(a, b), b);
});

test("isCompletionCountable is true only for a task CURRENTLY 'done' — a reopened task's earlier completion never counts (README decision 9)", () => {
  assert.equal(isCompletionCountable("done"), true);
  assert.equal(isCompletionCountable("open"), false);
  assert.equal(isCompletionCountable("cancelled"), false);
});
