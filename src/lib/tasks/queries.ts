import { and, asc, desc, eq, gt, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bd, task, type Task, type NewTask } from "@/db/schema";
import { isIdentityDualWriteEnabled } from "@/lib/identity/resolve";
import { personIdLookupSql } from "@/lib/identity/resolveDb";
import { resolvePersonIdLookup } from "@/lib/identity/referenceWrite";

export interface TaskFilters {
  leadId?: string;
  companyKey?: string;
  contactId?: string;
  assignedToBdId?: string;
  status?: "open" | "done" | "cancelled";
}

export interface TaskRow extends Task {
  assignedToName?: string | null;
}

export interface TasksPage {
  rows: TaskRow[];
  total: number;
}

export async function getTasks(
  filters: TaskFilters,
  limit: number = 50,
  offset: number = 0,
): Promise<TasksPage> {
  const conditions: SQL[] = [];

  if (filters.leadId) {
    conditions.push(eq(task.leadId, filters.leadId));
  }

  if (filters.companyKey) {
    conditions.push(eq(task.companyKey, filters.companyKey));
  }

  if (filters.contactId) {
    conditions.push(eq(task.contactId, filters.contactId));
  }

  if (filters.assignedToBdId) {
    conditions.push(eq(task.assignedToBdId, filters.assignedToBdId));
  }

  if (filters.status) {
    conditions.push(eq(task.status, filters.status));
  }

  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(task)
    .where(whereCondition);

  const rows = await db
    .select({
      id: task.id,
      leadId: task.leadId,
      companyKey: task.companyKey,
      contactId: task.contactId,
      personId: task.personId,
      actorBdId: task.actorBdId,
      assignedToBdId: task.assignedToBdId,
      title: task.title,
      description: task.description,
      status: task.status,
      dueAt: task.dueAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      assignedToName: bd.name,
    })
    .from(task)
    .leftJoin(bd, eq(task.assignedToBdId, bd.id))
    .where(whereCondition)
    .orderBy(asc(task.dueAt), desc(task.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    rows,
    total: total?.count ?? 0,
  };
}

export async function getOpenTasks(bdId: string, limit: number = 50): Promise<TaskRow[]> {
  return db
    .select({
      id: task.id,
      leadId: task.leadId,
      companyKey: task.companyKey,
      contactId: task.contactId,
      personId: task.personId,
      actorBdId: task.actorBdId,
      assignedToBdId: task.assignedToBdId,
      title: task.title,
      description: task.description,
      status: task.status,
      dueAt: task.dueAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      assignedToName: bd.name,
    })
    .from(task)
    .leftJoin(bd, eq(task.assignedToBdId, bd.id))
    .where(and(eq(task.assignedToBdId, bdId), eq(task.status, "open")))
    .orderBy(asc(task.dueAt), desc(task.createdAt))
    .limit(limit);
}

export async function getOverdueTasks(bdId: string): Promise<TaskRow[]> {
  return db
    .select({
      id: task.id,
      leadId: task.leadId,
      companyKey: task.companyKey,
      contactId: task.contactId,
      personId: task.personId,
      actorBdId: task.actorBdId,
      assignedToBdId: task.assignedToBdId,
      title: task.title,
      description: task.description,
      status: task.status,
      dueAt: task.dueAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      assignedToName: bd.name,
    })
    .from(task)
    .leftJoin(bd, eq(task.assignedToBdId, bd.id))
    .where(
      and(
        eq(task.assignedToBdId, bdId),
        eq(task.status, "open"),
        gt(sql`now()`, task.dueAt),
      ),
    )
    .orderBy(asc(task.dueAt));
}

/**
 * `person_id` is resolved via a `person_id_map` subquery in the same insert
 * statement (design "Reference writes"; task 4B.5) — no matcher, no
 * advisory lock, since this never creates a person.
 */
export async function createTask(input: NewTask): Promise<Task> {
  const lookup = input.personId == null ? resolvePersonIdLookup(input) : null;
  const values =
    lookup && isIdentityDualWriteEnabled() ? { ...input, personId: personIdLookupSql(lookup) } : input;
  const [row] = await db.insert(task).values(values).returning();
  return row!;
}

/**
 * Re-resolves `person_id` when the update itself changes the task's subject
 * (design "Reference writes": "`updateTask` re-resolves on subject change").
 * Untouched otherwise, so a plain status/title update never re-queries.
 */
export async function updateTask(taskId: string, updates: Partial<NewTask>): Promise<Task> {
  const lookup =
    updates.personId == null && (updates.leadId !== undefined || updates.contactId !== undefined)
      ? resolvePersonIdLookup(updates)
      : null;
  const set =
    lookup && isIdentityDualWriteEnabled()
      ? { ...updates, personId: personIdLookupSql(lookup), updatedAt: new Date() }
      : { ...updates, updatedAt: new Date() };
  const [row] = await db.update(task).set(set).where(eq(task.id, taskId)).returning();
  return row!;
}

export async function completeTask(taskId: string): Promise<Task> {
  return updateTask(taskId, { status: "done" });
}

export async function deleteTask(taskId: string): Promise<void> {
  await db.delete(task).where(eq(task.id, taskId));
}
