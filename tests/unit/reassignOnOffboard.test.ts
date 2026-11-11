import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REASSIGNABLE_TASK_STATUS,
  selectReassignableTasks,
  verifyTaskReassignment,
} from "@/lib/tasks/reassignOnOffboard";

const TASKS = [
  { id: "t1", status: "open" },
  { id: "t2", status: "done" },
  { id: "t3", status: "open" },
  { id: "t4", status: "cancelled" },
];

test("only open tasks move; done and cancelled keep pointing at the departing BD", () => {
  // The failure this pins: a status filter that quietly widens. Moving a DONE
  // task rewrites who did the work and shifts every per-BD completion count,
  // while the script reports a BIGGER, healthier-looking number.
  const { move, keep } = selectReassignableTasks(TASKS);
  assert.deepEqual(move.map((t) => t.id), ["t1", "t3"]);
  assert.deepEqual(keep.map((t) => t.id), ["t2", "t4"]);
  assert.equal(REASSIGNABLE_TASK_STATUS, "open");
});

test("the split never mutates its input and handles an empty list", () => {
  const copy = TASKS.map((t) => ({ ...t }));
  selectReassignableTasks(copy);
  assert.deepEqual(copy, TASKS);
  assert.deepEqual(selectReassignableTasks([]), { move: [], keep: [] });
});

test("open tasks still pointing at the departing BD fail the read-back", () => {
  const r = verifyTaskReassignment({ moved: 42, remainingOpen: 3, activitiesWritten: 42, doneLeftAlone: 18, doneBefore: 18 });
  assert.equal(r.ok, false);
  assert.match(r.problem ?? "", /still point at the departing BD/);
});

test("a moved task with no activity row fails the read-back", () => {
  // Every other number is perfect here. Accepting it means a task changed
  // hands with nobody recorded as having done it — the project rule is that
  // any BD may edit any task, but the change must name the actor.
  const r = verifyTaskReassignment({ moved: 42, remainingOpen: 0, activitiesWritten: 41, doneLeftAlone: 18, doneBefore: 18 });
  assert.equal(r.ok, false);
  assert.match(r.problem ?? "", /nobody recorded as having done it/);
});

test("a finished task that moved fails the read-back", () => {
  // THE case the status filter is there to prevent, caught after the fact by
  // counting what is LEFT rather than trusting what was selected.
  const r = verifyTaskReassignment({ moved: 42, remainingOpen: 0, activitiesWritten: 42, doneLeftAlone: 17, doneBefore: 18 });
  assert.equal(r.ok, false);
  assert.match(r.problem ?? "", /WHO DID THE WORK/);
});

test("zero open left, one activity per move and every finished task untouched is the only success", () => {
  assert.deepEqual(
    verifyTaskReassignment({ moved: 42, remainingOpen: 0, activitiesWritten: 42, doneLeftAlone: 18, doneBefore: 18 }),
    { ok: true, problem: null },
  );
  assert.equal(
    verifyTaskReassignment({ moved: 0, remainingOpen: 0, activitiesWritten: 0, doneLeftAlone: 18, doneBefore: 18 }).ok,
    true,
  );
});
