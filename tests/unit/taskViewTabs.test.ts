/**
 * Unit tests for src/lib/tasks/viewTabs.ts (mockup-port t03) — the pure tab
 * list behind /tasks's "Mis tareas abiertas" / "Todas abiertas" /
 * "Completadas" view tabs (tasks.html `.view-tabs`), an earlier reskin
 * skipped entirely.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isTaskView, taskViewTabs } from "@/lib/tasks/viewTabs";

test("isTaskView accepts only the three known views, defaulting callers to 'mine' otherwise", () => {
  assert.equal(isTaskView("mine"), true);
  assert.equal(isTaskView("all"), true);
  assert.equal(isTaskView("done"), true);
  assert.equal(isTaskView("bogus"), false);
  assert.equal(isTaskView(undefined), false);
});

const LABELS = { mine: "Mis tareas abiertas", all: "Todas abiertas", done: "Completadas" };

test("taskViewTabs returns the three tabs in mockup order, each with its own count and href", () => {
  const tabs = taskViewTabs({ mine: 9, all: 86, completed: 412 }, "mine", LABELS);
  assert.deepEqual(
    tabs.map((t) => ({ label: t.label, count: t.count, href: t.href, active: t.active })),
    [
      { label: "Mis tareas abiertas", count: 9, href: "/tasks?view=mine", active: true },
      { label: "Todas abiertas", count: 86, href: "/tasks?view=all", active: false },
      { label: "Completadas", count: 412, href: "/tasks?view=done", active: false },
    ],
  );
});

test("taskViewTabs marks the tab matching the given active view, never more than one", () => {
  const tabs = taskViewTabs({ mine: 1, all: 2, completed: 3 }, "done", LABELS);
  assert.deepEqual(
    tabs.map((t) => t.active),
    [false, false, true],
  );
});
