"use server";

import { revalidatePath } from "next/cache";
import { createTask, updateTask, completeTask } from "@/lib/tasks/queries";
import { searchTaskSubjects } from "@/lib/tasks/subjectSearchDb";
import type { TaskSubjectSearchResult } from "@/lib/tasks/subjectSearch";
import { getCurrentBd } from "@/lib/queries";
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
}) {
  const me = await getCurrentBd();

  const task = await createTask({
    ...input,
    assignedToBdId: me.id,
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
  },
) {
  const task = await updateTask(taskId, updates);

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
