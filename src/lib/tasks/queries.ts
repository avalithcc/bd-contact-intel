import { and, asc, desc, eq, gt, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bd, task, type Task, type NewTask } from "@/db/schema";

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

export async function createTask(input: NewTask): Promise<Task> {
  const [row] = await db.insert(task).values(input).returning();
  return row!;
}

export async function updateTask(taskId: string, updates: Partial<NewTask>): Promise<Task> {
  const [row] = await db
    .update(task)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(task.id, taskId))
    .returning();
  return row!;
}

export async function completeTask(taskId: string): Promise<Task> {
  return updateTask(taskId, { status: "done" });
}

export async function deleteTask(taskId: string): Promise<void> {
  await db.delete(task).where(eq(task.id, taskId));
}
