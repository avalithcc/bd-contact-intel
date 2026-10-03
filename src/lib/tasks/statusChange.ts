/**
 * True when asking for `next` would not change the task. Every task activity
 * (`task_completed`/`task_reopened`) records a change that happened, so a
 * request for the status the row already has must write neither the UPDATE
 * nor an activity. Pure so the rule is unit-testable; the caller applies it
 * to the row it read `FOR UPDATE`, which makes the check race-free.
 */
export function isTaskStatusNoOp(currentStatus: string, next: "open" | "done"): boolean {
  return currentStatus === next;
}
