/**
 * Single authorization rule for editing, completing and reopening a task
 * (task-edit change, owner spec "Security"): the task's assignee, its
 * creator, anyone who can edit the subject contact/company (via
 * `assertContactEditableById`, src/lib/contacts/queries.ts), or an admin.
 * Every write path (updateWithActivity.ts's `updateTaskWithActivity` and
 * `setTaskStatusChecked`) calls this ONE function instead of re-deriving the
 * rule per entry point.
 *
 * `checkContactEditable` defaults to the real `assertContactEditableById`
 * in production callers but is a parameter here (not imported directly) so
 * this stays unit-testable without a database — see
 * tests/unit/taskAuthorization.test.ts.
 *
 * Deliberately generic on failure: throws the same `TaskNotFoundError`
 * every other task-ownership check in this app throws (setTaskStatusForPerson's
 * original fix, src/lib/tasks/queries.ts) — a caller must never be able to
 * tell "this task doesn't exist" apart from "you can't touch this task" —
 * except when `checkContactEditable` itself throws a more specific error
 * (e.g. a merged contact): that error is never swallowed, since the
 * assignee/creator/admin bypass above already lets the task's own
 * owner/creator through even when the underlying contact is merged.
 */
import { TaskNotFoundError } from "@/lib/tasks/errors";

export interface TaskAuthSubject {
  assignedToBdId: string | null;
  actorBdId: string | null;
  personId: string | null;
  companyKey: string | null;
}

export interface TaskAuthActor {
  id: string;
  role: string;
}

export async function assertTaskAuthorized(
  task: TaskAuthSubject,
  me: TaskAuthActor,
  checkContactEditable: (personId: string) => Promise<void>,
): Promise<void> {
  if (task.assignedToBdId === me.id) return;
  if (task.actorBdId === me.id) return;
  if (me.role === "admin") return;

  if (task.personId) {
    await checkContactEditable(task.personId);
    return;
  }

  // Company-scoped tasks have no per-BD editable gate today (no merge
  // concept for companies — any signed-in BD may already edit any company
  // via updateCompanyPropertyAction/addCompanyTaskAction with no ownership
  // check), so anyone reaching this branch is authorized.
  if (task.companyKey) return;

  throw new TaskNotFoundError();
}
