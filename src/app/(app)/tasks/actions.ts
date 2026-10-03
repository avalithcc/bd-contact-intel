"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { assertAssigneeExists, getTaskById, getTaskCompletionInfo } from "@/lib/tasks/queries";
import { createTaskWithActivity, updateTaskWithActivity, setTaskStatusChecked, type TaskEditInput } from "@/lib/tasks/updateWithActivity";
import { assertTaskAuthorized } from "@/lib/tasks/authorization";
import { assertContactEditableById } from "@/lib/contacts/queries";
import { searchTaskSubjects } from "@/lib/tasks/subjectSearchDb";
import type { TaskSubjectSearchResult } from "@/lib/tasks/subjectSearch";
import { getCurrentBd } from "@/lib/queries";
import { resolveTaskAssignee, InvalidAssigneeError } from "@/lib/tasks/assignee";
import type { NewTask, Task } from "@/db/schema";

/** Read side of the "Nueva tarea" dialog's subject picker (mockup-port
 * t04) — searches contacts/companies by name, bounded server-side. */
export async function searchTaskSubjectsAction(query: string): Promise<TaskSubjectSearchResult[]> {
  // Re-check the session inside the action, like every other server action.
  await getCurrentBd();
  return searchTaskSubjects(query);
}

export async function createTaskAction(input: {
  title: string;
  description?: string;
  leadId?: string;
  companyKey?: string;
  contactId?: string;
  // Unified-Contact subject (design D1); record page's quick actions (9.2).
  personId?: string;
  dueAt?: Date;
  // Raw `<select>` value (task-essentials backlog item 2): blank/omitted
  // defaults to the creator, same contract as resolveTaskAssignee.
  assignedToBdId?: string;
}) {
  const me = await getCurrentBd();

  const assignedToBdId = resolveTaskAssignee(input.assignedToBdId ?? "", me.id);
  if (assignedToBdId === undefined) throw new InvalidAssigneeError();
  await assertAssigneeExists(assignedToBdId, me.id);

  // The task and its `task_created` activity are one transaction.
  const task = await createTaskWithActivity(
    {
      ...input,
      assignedToBdId,
      // Who created this task (design "Reference writes"; task 4B.5).
      actorBdId: me.id,
    } as NewTask,
    me,
  );

  revalidatePath("/tasks");
  revalidatePath("/leads");
  revalidatePath("/companies");
  if (input.personId) revalidatePath(`/contacts/${input.personId}`);

  return task;
}

/** Revalidates every path a task write can affect — the same fixed set
 * every task action here already revalidated, plus whichever record page
 * the task's OWN (just-written) subject points at. */
function revalidateTaskPaths(task: Task): void {
  revalidatePath("/tasks");
  revalidatePath("/leads");
  revalidatePath("/companies");
  if (task.personId) revalidatePath(`/contacts/${task.personId}`);
  if (task.companyKey) revalidatePath(`/companies/${task.companyKey}`);
}

/**
 * "Editar tarea" dialog's save (task-edit change). Diffs against the task's
 * current row and writes a `task_updated` activity in the same transaction
 * as the UPDATE — see updateTaskWithActivity.ts. Authorization (assignee,
 * creator, anyone who can edit the subject, or an admin) and the id+subject
 * scoped WHERE both live there too, not here.
 */
export async function updateTaskAction(taskId: string, updates: TaskEditInput): Promise<Task> {
  const me = await getCurrentBd();
  const task = await updateTaskWithActivity(taskId, me, updates);
  revalidateTaskPaths(task);
  return task;
}

/**
 * Completes or reopens a task from ANY entry point — this dialog, a list
 * checkbox (CompleteTaskButton.tsx), a record page's Tareas card, or the
 * timeline's "Marcar como hecha"/"Reabrir" — all route through this one
 * action so every surface authorizes, scopes and logs identically (fixes
 * the IDOR `completeCompanyTaskAction` had via the old unscoped
 * `completeTaskAction`).
 */
export async function setTaskStatusAction(taskId: string, status: "open" | "done"): Promise<Task> {
  const me = await getCurrentBd();
  const task = await setTaskStatusChecked(taskId, status, me);
  revalidateTaskPaths(task);
  return task;
}

/**
 * Lazy fetch for the dialog's "Completada el … · <nombre>" caption (mockup
 * decision 5) — only called when the dialog opens for an already-completed
 * task, never from a record page's own render.
 *
 * Review fix (WARNING #3): this used to accept and trust a client-supplied
 * `subject` for the scoped read below — a caller could claim any
 * personId/companyKey regardless of which task it actually belonged to.
 * Now derives the subject from the task row itself and authorizes through
 * the same `assertTaskAuthorized` rule every write path uses; any failure
 * (not found, not authorized) degrades to `null` — a missing caption, never
 * a thrown error over a read-only lazy fetch.
 */
export async function getTaskCompletionInfoAction(
  taskId: string,
): Promise<{ at: Date; byName: string | null } | null> {
  try {
    const me = await getCurrentBd();
    const current = await getTaskById(taskId);
    if (!current) return null;
    await assertTaskAuthorized(current, me, assertContactEditableById);
    return await getTaskCompletionInfo(taskId, { personId: current.personId, companyKey: current.companyKey });
  } catch (err) {
    // A redirect()/notFound() thrown inside the try (getCurrentBd()'s
    // defense-in-depth auth redirect) must reach Next's router, not be
    // swallowed into a plain `null` — see tests/unit/rethrowNavigationErrors.test.ts.
    unstable_rethrow(err);
    return null;
  }
}
