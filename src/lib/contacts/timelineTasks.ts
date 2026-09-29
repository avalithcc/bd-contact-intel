/**
 * Pure sort for the record page's "Tareas" filter pill (mockup-port
 * timeline-tasks-pill; contact-record.html:104). No DB, no dictionary —
 * Timeline.tsx renders whatever order this returns.
 *
 * Unlike `@/lib/contacts/timelineGrouping`'s `upcomingTasks` (which only ever
 * shows OPEN tasks with a due date, in the "Próximas" bucket that's visible
 * regardless of the active pill), this pill shows a Contact's full task
 * history — open AND done — so a completed task stays discoverable after it
 * no longer appears in "Próximas" or the right-panel Tareas card.
 */
export interface TimelineTaskItem {
  id: string;
  title: string;
  status: "open" | "done";
  dueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignedToName: string | null;
}

function compareOpenTasks(a: TimelineTaskItem, b: TimelineTaskItem): number {
  // Soonest due date first; a task with no due date sorts after every dated
  // one (nothing to rank it against), tie-broken newest-created-first.
  if (a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime();
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return b.createdAt.getTime() - a.createdAt.getTime();
}

/**
 * Open tasks first (soonest due date first), then done tasks (most recently
 * completed first — a done task has no meaningful due-date ordering left,
 * the same rule `getCompletedTasks`, src/lib/tasks/queries.ts, already
 * applies for /tasks' own "Completadas" tab).
 */
export function sortTasksForTimelinePill<T extends TimelineTaskItem>(tasks: readonly T[]): T[] {
  const open = tasks.filter((t) => t.status === "open").sort(compareOpenTasks);
  const done = tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return [...open, ...done];
}

/**
 * Pure combine step behind `getTasksForPerson`'s two independently-bounded
 * reads (src/lib/tasks/queries.ts — review fix, timeline-tasks-pill): open
 * tasks first, done tasks after. Kept here (DB-free) so it's unit-testable
 * on its own. A plain concatenation, not a shared slice, so a `doneRows`
 * array of any size can never push an `openRows` entry out — the bug this
 * replaces was one query with one shared SQL `LIMIT` across both statuses,
 * which could silently drop an open task once enough done ones (which only
 * ever accumulate) piled up ahead of it in that single ordering.
 */
export function combineOpenAndDoneTasks<T>(openRows: readonly T[], doneRows: readonly T[]): T[] {
  return [...openRows, ...doneRows];
}
