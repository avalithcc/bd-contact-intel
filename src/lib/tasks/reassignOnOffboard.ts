/**
 * Pure guards for scripts/reassign-bd-open-tasks.ts — moving a departing BD's
 * OPEN tasks to someone who can actually do them.
 *
 * WHY THIS IS A TESTED MODULE: the two ways this write goes wrong are both
 * invisible in its own success output.
 *
 * 1. Reassigning a task that is already DONE. `task.assigned_to_bd_id` on a
 *    finished task is not a to-do pointer, it is the RECORD OF WHO DID THE
 *    WORK. Moving it says the new assignee did work they never did, and every
 *    per-BD completion count silently shifts with it. A status filter that
 *    quietly widens produces more rows, a bigger number, and a cheerful
 *    report.
 * 2. Moving a task without writing its `activity` row. Project rule: any BD
 *    may edit any task, but every change must log an activity naming the
 *    actor (src/lib/tasks/updateWithActivity.ts). A move with no activity is
 *    a task that changed hands with nobody recorded as having done it, and
 *    the contact's timeline simply does not mention it.
 */

/** The only status whose assignee is a live to-do pointer rather than a record of completed work. */
export const REASSIGNABLE_TASK_STATUS = "open";

/**
 * Splits a departing BD's tasks into the ones whose assignee may move and the
 * ones that must keep pointing at them. Pure; never mutates its input.
 */
export function selectReassignableTasks<T extends { status: string }>(
  tasks: readonly T[],
): { move: T[]; keep: T[] } {
  const move: T[] = [];
  const keep: T[] = [];
  for (const t of tasks) (t.status === REASSIGNABLE_TASK_STATUS ? move : keep).push(t);
  return { move, keep };
}

export interface TaskReassignmentVerification {
  ok: boolean;
  /** Null when ok; otherwise what is wrong, phrased for an operator reading a terminal. */
  problem: string | null;
}

/**
 * Read-back check, run AFTER the transaction commits against numbers read
 * fresh from the database — not against what the writer believed it did.
 */
export function verifyTaskReassignment(input: {
  moved: number;
  remainingOpen: number;
  activitiesWritten: number;
  doneLeftAlone: number;
  doneBefore: number;
}): TaskReassignmentVerification {
  if (input.remainingOpen !== 0) {
    return { ok: false, problem: `${input.remainingOpen} open task(s) still point at the departing BD.` };
  }
  if (input.activitiesWritten < input.moved) {
    return {
      ok: false,
      problem:
        `${input.activitiesWritten} activity row(s) were written for ${input.moved} moved task(s). ` +
        "The unlogged ones changed hands with nobody recorded as having done it, and they are missing from the " +
        "contact's timeline.",
    };
  }
  if (input.doneLeftAlone !== input.doneBefore) {
    return {
      ok: false,
      problem:
        `${input.doneBefore} finished task(s) belonged to the departing BD but ${input.doneLeftAlone} still do. ` +
        "A finished task's assignee is the record of WHO DID THE WORK — moving it credits the new assignee with " +
        "work they never did and shifts every per-BD completion count.",
    };
  }
  return { ok: true, problem: null };
}
