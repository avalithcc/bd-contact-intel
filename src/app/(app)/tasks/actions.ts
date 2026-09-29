"use server";

import { revalidatePath } from "next/cache";
import { createTask, updateTask, completeTask, assertAssigneeExists } from "@/lib/tasks/queries";
import { searchTaskSubjects } from "@/lib/tasks/subjectSearchDb";
import type { TaskSubjectSearchResult } from "@/lib/tasks/subjectSearch";
import { getCurrentBd } from "@/lib/queries";
import { resolveTaskAssignee, InvalidAssigneeError } from "@/lib/tasks/assignee";
import type { NewTask } from "@/db/schema";

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

  const task = await createTask({
    ...input,
    assignedToBdId,
    // Who created this task (design "Reference writes"; task 4B.5).
    actorBdId: me.id,
  } as NewTask);

  revalidatePath("/tasks");
  revalidatePath("/leads");
  revalidatePath("/companies");
  if (input.personId) revalidatePath(`/contacts/${input.personId}`);

  return task;
}

export async function updateTaskAction(
  taskId: string,
  updates: {
    title?: string;
    description?: string;
    dueAt?: Date | null;
    status?: "open" | "done" | "cancelled";
    // Raw `<select>` value; omitted means "leave the assignee unchanged"
    // (unlike createTaskAction, an edit must be able to touch title/due
    // date without forcing a reassignment).
    assignedToBdId?: string;
  },
) {
  const me = await getCurrentBd();
  const { assignedToBdId: rawAssignee, ...rest } = updates;

  let values: Partial<NewTask> = rest;
  if (rawAssignee !== undefined) {
    const assignedToBdId = resolveTaskAssignee(rawAssignee, me.id);
    if (assignedToBdId === undefined) throw new InvalidAssigneeError();
    await assertAssigneeExists(assignedToBdId, me.id);
    values = { ...rest, assignedToBdId };
  }

  const task = await updateTask(taskId, values);

  revalidatePath("/tasks");
  revalidatePath("/leads");
  revalidatePath("/companies");

  return task;
}

export async function completeTaskAction(taskId: string) {
  const task = await completeTask(taskId);

  revalidatePath("/tasks");
  revalidatePath("/leads");
  revalidatePath("/companies");

  return task;
}
