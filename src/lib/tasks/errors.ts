/**
 * Thrown when a task write scoped to a specific owner (e.g. a Contact via
 * `person_id`) matches no row — either the task doesn't exist, or it exists
 * but belongs to someone/something else (review fix, timeline-tasks-pill:
 * `completeContactTaskAction`/`reopenContactTaskAction` used to update a
 * task by `id` alone, with no check that it actually belonged to the
 * `personId` the caller claimed). Deliberately generic, same as
 * `ContactNotFoundError` (src/lib/contacts/errors.ts): a caller must never
 * be able to distinguish "this task doesn't exist" from "this task isn't
 * yours" from the error alone — both map to the same "not_found" reason in
 * actionErrors.ts.
 *
 * Lives here (not in tasks/queries.ts, which imports the live `db`
 * connection) so DB-free callers — like
 * src/app/(app)/contacts/actionErrors.ts, unit-tested without a database —
 * can map it to a reason without pulling in `db`, same rule
 * `InvalidAssigneeError` (tasks/assignee.ts) already follows.
 */
export class TaskNotFoundError extends Error {
  constructor() {
    super("Task not found");
    this.name = "TaskNotFoundError";
  }
}
