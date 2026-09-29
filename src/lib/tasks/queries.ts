import { and, asc, desc, eq, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bd, company, person, task, type Task, type NewTask } from "@/db/schema";
import { argentinaDayBoundaries } from "@/lib/tasks/argentinaDate";
import { isIdentityDualWriteEnabled } from "@/lib/identity/resolve";
import { personIdLookupSql } from "@/lib/identity/resolveDb";
import { resolvePersonIdLookup } from "@/lib/identity/referenceWrite";
import type { TaskSubjectInput } from "@/lib/tasks/subject";
// The error class itself lives in assignee.ts (a DB-free module), not here —
// see that file's doc comment for why (src/app/(app)/contacts/actionErrors.ts
// is unit-tested without a database and must not transitively import `db`).
import { InvalidAssigneeError } from "@/lib/tasks/assignee";
import { TaskNotFoundError } from "@/lib/tasks/errors";
import { combineOpenAndDoneTasks } from "@/lib/contacts/timelineTasks";

export interface TaskFilters {
  leadId?: string;
  companyKey?: string;
  contactId?: string;
  assignedToBdId?: string;
  status?: "open" | "done" | "cancelled";
}

export interface TaskRow extends Task, TaskSubjectInput {
  assignedToName?: string | null;
}

/**
 * One select shape shared by every /tasks read below (mockup-port t02): the
 * "Asociado con" column needs the real Contact/Company name, not just the
 * `personId`/`companyKey` foreign key — so every task list left-joins
 * `person` (on its PK) and `company` (on its PK) once, here, instead of
 * each read building its own ad-hoc join (data-builder rule: no per-row
 * queries — this is a single bounded join, not a loop).
 */
function taskSubjectSelect() {
  return {
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
    subjectPersonFirstName: person.firstName,
    subjectPersonLastName: person.lastName,
    subjectPersonCompany: person.company,
    subjectCompanyName: company.displayName,
  } as const;
}

function baseTaskSubjectQuery() {
  return db
    .select(taskSubjectSelect())
    .from(task)
    .leftJoin(bd, eq(task.assignedToBdId, bd.id))
    .leftJoin(person, eq(task.personId, person.id))
    .leftJoin(company, eq(task.companyKey, company.companyKey));
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

  const rows = await baseTaskSubjectQuery()
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
  return baseTaskSubjectQuery()
    .where(and(eq(task.assignedToBdId, bdId), eq(task.status, "open")))
    .orderBy(asc(task.dueAt), desc(task.createdAt))
    .limit(limit);
}

/**
 * "Todas abiertas" view tab (mockup-port t01; tasks.html `.view-tabs`) — the
 * same open-task shape as `getOpenTasks`, just without the assignee filter,
 * since this tab shows every BD's open tasks, not only the current one's.
 */
export async function getAllOpenTasks(limit: number = 100): Promise<TaskRow[]> {
  return baseTaskSubjectQuery()
    .where(eq(task.status, "open"))
    .orderBy(asc(task.dueAt), desc(task.createdAt))
    .limit(limit);
}

/**
 * "Completadas" view tab (mockup-port t01) — `status = 'done'`, most
 * recently updated first (a completed task has no meaningful `dueAt`
 * ordering left), bounded by `limit`/`offset` since this list can grow
 * unbounded over time (task_status_idx covers the filter).
 */
export async function getCompletedTasks(limit: number = 50, offset: number = 0): Promise<TaskRow[]> {
  return baseTaskSubjectQuery()
    .where(eq(task.status, "done"))
    .orderBy(desc(task.updatedAt))
    .limit(limit)
    .offset(offset);
}

export interface TaskViewCounts {
  mine: number;
  all: number;
  completed: number;
}

/**
 * Badge counts for the /tasks view tabs (mockup-port t03; tasks.html
 * `.view-tabs .count`) — three bounded `count(*)` queries, each covered by
 * `task_assignee_idx`/`task_status_idx`, instead of fetching every row just
 * to `.length` it (that would defeat the point of bounding the tab reads).
 */
export async function getTaskViewCounts(bdId: string): Promise<TaskViewCounts> {
  const [[mine], [all], [completed]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(task)
      .where(and(eq(task.assignedToBdId, bdId), eq(task.status, "open"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(task)
      .where(eq(task.status, "open")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(task)
      .where(eq(task.status, "done")),
  ]);

  return {
    mine: mine?.count ?? 0,
    all: all?.count ?? 0,
    completed: completed?.count ?? 0,
  };
}

const OPEN_TASKS_FOR_PERSON_LIMIT = 50;
const DONE_TASKS_FOR_PERSON_LIMIT = 20;

export interface TasksForPerson {
  /** Open tasks first (their existing order), then done tasks — see
   * `combineOpenAndDoneTasks` (@/lib/contacts/timelineTasks). */
  rows: TaskRow[];
  /** TRUE count of this Contact's open tasks, never capped by
   * `OPEN_TASKS_FOR_PERSON_LIMIT` — see the `count(*) over ()` doc comment
   * below. */
  openCount: number;
  /** Same guarantee as `openCount`, for done tasks. */
  doneCount: number;
}

/**
 * Every open-or-done task for one Contact (mockup-port r03/r05 +
 * timeline-tasks-pill; contact-record.html's "Próximas" timeline bucket,
 * right-panel "Tareas" card, and the Actividad tab's "Tareas" filter pill —
 * contact-record.html:104). `page.tsx` filters `rows` down to
 * `status === "open"` for the first two (unchanged behavior); Timeline.tsx
 * uses the full `rows` array (open + done) for the pill, and `openCount`/
 * `doneCount` for its "never capped" pill/Todo totals (see the doc comment
 * on `TimelineProps.countsByType`, Timeline.tsx). `cancelled` tasks are
 * excluded from all three — neither the "Próximas" bucket, the right-panel
 * card, nor the Tareas pill has ever shown them.
 *
 * Bug fix (review): this used to be ONE query with ONE shared `LIMIT` across
 * both statuses. Done tasks only ever accumulate — nothing ever un-completes
 * one — so once they outnumbered the limit they could silently push an open
 * task out of the result entirely, and an open task missing here disappears
 * from "Próximas", the right-panel card, AND the pill all at once. Now two
 * independently bounded reads (open: `OPEN_TASKS_FOR_PERSON_LIMIT`, done:
 * `DONE_TASKS_FOR_PERSON_LIMIT`), so neither can ever displace the other —
 * `combineOpenAndDoneTasks`'s own unit test (tests/unit/timelineTasks.test.ts)
 * pins that guarantee directly. Costs one extra round trip over the old
 * single-query shape (both queries run concurrently via `Promise.all`, so
 * the extra cost is one queueing slot on the pool, not one full extra
 * latency hop — see page.tsx's own `Promise.all` this is already called
 * inside of) in exchange for correctness a capped shared query can't give.
 *
 * `count(*) over ()` in each query's SELECT list is Postgres's own "give me
 * the true total alongside a LIMITed page" idiom: window functions evaluate
 * over the full WHERE-matched set BEFORE `ORDER BY`/`LIMIT` apply, so
 * `openCount`/`doneCount` are exact regardless of the two limits above —
 * this is the SAME round trip as the row fetch, not a third query (same
 * pattern `getPersonTimeline`, @/lib/activity/queries, uses two queries for
 * — rows and counts — but this piggybacks the count onto the rows query
 * instead, since the "many done, few open" shape here makes a `GROUP BY`
 * over the unbounded full set proportionally more wasteful than there).
 */
export async function getTasksForPerson(personId: string): Promise<TasksForPerson> {
  const withTotal = { ...taskSubjectSelect(), totalCount: sql<number>`count(*) over ()::int` };

  const [openRows, doneRows] = await Promise.all([
    db
      .select(withTotal)
      .from(task)
      .leftJoin(bd, eq(task.assignedToBdId, bd.id))
      .leftJoin(person, eq(task.personId, person.id))
      .leftJoin(company, eq(task.companyKey, company.companyKey))
      .where(and(eq(task.personId, personId), eq(task.status, "open")))
      .orderBy(asc(task.dueAt), desc(task.createdAt))
      .limit(OPEN_TASKS_FOR_PERSON_LIMIT),
    db
      .select(withTotal)
      .from(task)
      .leftJoin(bd, eq(task.assignedToBdId, bd.id))
      .leftJoin(person, eq(task.personId, person.id))
      .leftJoin(company, eq(task.companyKey, company.companyKey))
      .where(and(eq(task.personId, personId), eq(task.status, "done")))
      .orderBy(desc(task.updatedAt))
      .limit(DONE_TASKS_FOR_PERSON_LIMIT),
  ]);

  return {
    rows: combineOpenAndDoneTasks(openRows, doneRows),
    openCount: openRows[0]?.totalCount ?? 0,
    doneCount: doneRows[0]?.totalCount ?? 0,
  };
}

/**
 * Overdue = due calendar date strictly before today's Argentina date, i.e.
 * `due_at < todayStartUtc` (today's calendar date at 00:00 UTC — `due_at`
 * is a stored calendar date, never a real instant, see argentinaDate.ts).
 * Bug fixed here: this used to compare `now() > due_at` as real instants,
 * which flagged a task due today as overdue almost immediately (Postgres
 * `now()`, naive-compared against a UTC-session `timestamp without time
 * zone` column, crosses midnight UTC hours before the ART calendar day
 * ends).
 */
export async function getOverdueTasks(bdId: string): Promise<TaskRow[]> {
  const { todayStartUtc } = argentinaDayBoundaries(new Date());
  return baseTaskSubjectQuery()
    .where(
      and(
        eq(task.assignedToBdId, bdId),
        eq(task.status, "open"),
        isNotNull(task.dueAt),
        lt(task.dueAt, todayStartUtc),
      ),
    )
    .orderBy(asc(task.dueAt));
}

/**
 * "Todas abiertas" counterpart of `getOverdueTasks` (bug fix, task-essentials
 * backlog item 3) — same overdue definition, no `assignedToBdId` filter,
 * mirroring how `getAllOpenTasks` mirrors `getOpenTasks`. Before this
 * existed, the "all" view passed a hardcoded `overdueTasks = []` to
 * `buildTaskBuckets`, so a teammate's overdue task was never shown as
 * overdue anywhere on that tab.
 */
export async function getAllOverdueTasks(): Promise<TaskRow[]> {
  const { todayStartUtc } = argentinaDayBoundaries(new Date());
  return baseTaskSubjectQuery()
    .where(and(eq(task.status, "open"), isNotNull(task.dueAt), lt(task.dueAt, todayStartUtc)))
    .orderBy(asc(task.dueAt));
}

/**
 * Sidebar "Tareas" badge count (task-reminders backlog): today + overdue
 * open tasks for the signed-in BD, one bounded `count(*)` covered by
 * `task_assignee_idx`/`task_status_idx`/`task_due_idx` — the same shape as
 * `getTaskViewCounts` above, not a fetch-and-`.length`. `before` is
 * `tomorrowStartUtc` from `argentinaDayBoundaries` — tomorrow's calendar
 * date at 00:00 UTC (NOT ART midnight, 03:00 UTC — that would be >= a
 * due-tomorrow task's own `due_at` and wrongly count it). A task is counted
 * once it's due today or earlier, never for a future due date.
 * Costs exactly one round trip; the caller (AppLayout) already has
 * `bdId` for free from the cached `getCurrentBd()` call every page under it
 * makes.
 */
export async function getTaskBadgeCount(bdId: string, before: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(task)
    .where(
      and(
        eq(task.assignedToBdId, bdId),
        eq(task.status, "open"),
        isNotNull(task.dueAt),
        lt(task.dueAt, before),
      ),
    );
  return row?.count ?? 0;
}

export async function isAssignableBd(bdId: string): Promise<boolean> {
  const [row] = await db.select({ id: bd.id }).from(bd).where(eq(bd.id, bdId));
  return !!row;
}

/**
 * Validates a resolved assignee before a task write reaches the `assigned_to_bd_id`
 * FK (same "pre-check instead of an opaque 500 on the FK" pattern as
 * `bulkAssignOwner`, src/lib/contacts/bulkOwnerDb.ts). Skips the query when
 * `assignedToBdId` is the caller's own id — `getCurrentBd()` already
 * guarantees that row exists, so every unmodified "assign to me" task
 * creation (the common case, unchanged from before this feature) costs zero
 * extra round trips.
 */
export async function assertAssigneeExists(assignedToBdId: string, creatorBdId: string): Promise<void> {
  if (assignedToBdId === creatorBdId) return;
  if (!(await isAssignableBd(assignedToBdId))) throw new InvalidAssigneeError();
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
 *
 * Bug fix (review): `.returning()` on a `WHERE id = taskId` that matches
 * nothing (task already deleted, or a bad id) used to return an empty array,
 * and the old `row!` non-null assertion turned that into `undefined` silently
 * reported as a successful `Task` to every caller. Now throws
 * `TaskNotFoundError` instead — callers that don't already handle it (see
 * `completeTask`/`setTaskStatusForPerson` below, and every server action that
 * wraps them) surface it as a thrown rejection, same as any other typed task
 * error in this file.
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
  if (!row) throw new TaskNotFoundError();
  return row;
}

export async function completeTask(taskId: string): Promise<Task> {
  return updateTask(taskId, { status: "done" });
}

/**
 * Ownership-scoped task status write (review fix, timeline-tasks-pill):
 * `completeContactTaskAction`/`reopenContactTaskAction` (contacts/actions.ts)
 * used to update a task by `id` alone — no check that it actually belonged
 * to the `personId` the caller claimed, so any signed-in BD could complete
 * or reopen ANY task by guessing/copying its id into the wrong Contact's
 * page. The ownership check is part of the write itself
 * (`WHERE id = taskId AND person_id = personId`), not a separate read-then-
 * write — a row that exists but belongs to a different person never matches
 * and throws the same `TaskNotFoundError` as a genuinely missing task
 * (never let a caller distinguish the two — see that error's doc comment).
 */
export async function setTaskStatusForPerson(
  taskId: string,
  personId: string,
  status: "open" | "done",
): Promise<Task> {
  const [row] = await db
    .update(task)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(task.id, taskId), eq(task.personId, personId)))
    .returning();
  if (!row) throw new TaskNotFoundError();
  return row;
}

export async function deleteTask(taskId: string): Promise<void> {
  await db.delete(task).where(eq(task.id, taskId));
}
