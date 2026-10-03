/**
 * The no-op rule behind `setTaskStatusChecked`: asking for the status a task
 * already has must write nothing, in particular no activity row (every task
 * activity claims a change happened, so a duplicate would lie in the audit
 * trail).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isTaskStatusNoOp } from "@/lib/tasks/statusChange";

test("completing a task that is already done is a no-op", () => {
  assert.equal(isTaskStatusNoOp("done", "done"), true);
});

test("reopening a task that is already open is a no-op", () => {
  assert.equal(isTaskStatusNoOp("open", "open"), true);
});

test("a real transition is not a no-op", () => {
  assert.equal(isTaskStatusNoOp("open", "done"), false);
  assert.equal(isTaskStatusNoOp("done", "open"), false);
});

test("a cancelled task asked to be completed or reopened is a real transition", () => {
  assert.equal(isTaskStatusNoOp("cancelled", "done"), false);
  assert.equal(isTaskStatusNoOp("cancelled", "open"), false);
});
