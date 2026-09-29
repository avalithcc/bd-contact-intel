/**
 * Unit tests for src/lib/contacts/timelineTasks.ts (mockup-port
 * timeline-tasks-pill; contact-record.html:104's "Tareas" filter pill).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sortTasksForTimelinePill, type TimelineTaskItem } from "@/lib/contacts/timelineTasks";

function task(
  overrides: Partial<TimelineTaskItem> & Pick<TimelineTaskItem, "id" | "status">,
): TimelineTaskItem {
  return {
    title: "Tarea",
    dueAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    assignedToName: null,
    ...overrides,
  };
}

test("open tasks sort by soonest due date first, undated tasks last (newest-created first among those)", () => {
  const dueLater = task({ id: "later", status: "open", dueAt: new Date("2026-10-20T00:00:00Z") });
  const dueSoon = task({ id: "soon", status: "open", dueAt: new Date("2026-10-10T00:00:00Z") });
  const undatedOld = task({ id: "undated-old", status: "open", createdAt: new Date("2026-09-01T00:00:00Z") });
  const undatedNew = task({ id: "undated-new", status: "open", createdAt: new Date("2026-09-15T00:00:00Z") });

  const result = sortTasksForTimelinePill([dueLater, undatedOld, dueSoon, undatedNew]);

  assert.deepEqual(
    result.map((t) => t.id),
    ["soon", "later", "undated-new", "undated-old"],
  );
});

test("done tasks sort by most recently completed first, and always come after every open task", () => {
  const open = task({ id: "open", status: "open", dueAt: new Date("2026-10-20T00:00:00Z") });
  const doneOld = task({ id: "done-old", status: "done", updatedAt: new Date("2026-09-01T00:00:00Z") });
  const doneNew = task({ id: "done-new", status: "done", updatedAt: new Date("2026-09-15T00:00:00Z") });

  const result = sortTasksForTimelinePill([doneOld, open, doneNew]);

  assert.deepEqual(
    result.map((t) => t.id),
    ["open", "done-new", "done-old"],
  );
});
