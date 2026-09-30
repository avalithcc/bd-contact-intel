import { and, asc, desc, eq, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { activity, bd, company, person, task, type Task, type NewTask } from "@/db/schema";
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
import { parseDbTimestamp } from "@/lib/db/timestamp";

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

/** Raw shape of one row from `getTasksForPerson`'s window-function query —
 * `TaskRow`'s columns plus the two window values that never reach the
 * caller. Dates come back as `Date | string` because raw `db.execute`
 * bypasses drizzle's column mappers (same rule `getSyncStatus`,
 * @/lib/whatsnew/queries.ts, already documents) — `toTaskRow` below
 * normalizes both to `Date`. */
type TaskWindowRow = {
  id: string;
  leadId: string | null;
  companyKey: string | null;
  contactId: string | null;
  personId: string | null;
  actorBdId: string | null;
  assignedToBdId: string | null;
  title: string;
  description: string | null;
  status: string;
  dueAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  assignedToName: string | null;
  subjectPersonFirstName: string | null;
  subjectPersonLastName: string | null;
  subjectPersonCompany: string | null;
  subjectCompanyName: string | null;
  /** 1-based rank within this row's own `status` partition, per-status
   * order (open: due_at asc nulls last, created_at desc; done: updated_at
   * desc) — used only to re-sort each status group after the fetch, then
   * discarded. */
  rn: number;
  /** TRUE row count of this row's `status` partition, unaffected by the
   * `rn <=` filter below — see `openCount`/`doneCount` on `TasksForPerson`. */
  statusCount: number;
};

/** Every task timestamp column is `timestamp without time zone` holding UTC,
 * and raw `db.execute` returns it as an offset-less string. `new Date()`
 * would read that in the process's local timezone, so an offset-less value is
 * pinned to UTC explicitly, matching drizzle's own column mapper. Delegates
 * to the ONE shared helper (src/lib/db/timestamp.ts#parseDbTimestamp) every
 * other raw DB timestamp call site now uses, so this rule can never drift
 * from theirs. */
function toDate(value: Date | string): Date {
  return parseDbTimestamp(value);
}

function toTaskRow(row: TaskWindowRow): TaskRow {
  return {
    id: row.id,
    leadId: row.leadId,
    companyKey: row.companyKey,
    contactId: row.contactId,
    personId: row.personId,
    actorBdId: row.actorBdId,
    assignedToBdId: row.assignedToBdId,
    title: row.title,
    description: row.description,
    status: row.status,
    dueAt: row.dueAt ? toDate(row.dueAt) : null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    assignedToName: row.assignedToName,
    subjectPersonFirstName: row.subjectPersonFirstName,
    subjectPersonLastName: row.subjectPersonLastName,
    subjectPersonCompany: row.subjectPersonCompany,
    subjectCompanyName: row.subjectCompanyName,
  };
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
 * ONE round trip (review fix: an earlier version of this fix used two
 * queries via `Promise.all` — correct, but 2 round trips against a prod
 * pool of `max: 3` on a page whose `Promise.all` already runs 3 other
 * queries concurrently is exactly the pressure PERFORMANCE.md:26/:45 warns
 * against: `Promise.all` reorders round trips, it does not remove them).
 * A single raw-SQL query instead, using `row_number() over (partition by
 * status order by ...)` to rank each status's rows in ITS OWN per-status
 * order (open: due_at asc nulls last, created_at desc; done: updated_at
 * desc — the exact orders the old two `ORDER BY`s used) and `count(*) over
 * (partition by status)` for that status's TRUE total — both BEFORE any
 * `LIMIT`/filter applies, so `openCount`/`doneCount` are exact regardless of
 * the `rn <=` cutoffs below. An outer `WHERE rn <= N` (N per status) is
 * `getTasksForPerson`'s SQL-level version of `combineOpenAndDoneTasks`'s
 * guarantee: because open and done are independent PARTITIONs, a done row's
 * rank can never affect an open row's rank or its cutoff — one shared
 * `LIMIT` (the original bug) is exactly what a `partition by status` window
 * makes impossible.
 *
 * Column names are written as literal, already-qualified SQL text
 * (`task.due_at`, not `${task.dueAt}`) rather than interpolating drizzle's
 * `Column` objects — `task.status`/`task.due_at`/`task.created_at`/
 * `task.updated_at` each appear more than once in this query (SELECT,
 * PARTITION BY, ORDER BY), and PERFORMANCE.md documents a Drizzle 0.36.4
 * bug where reusing a `Column` reference already used as a bare `.select()`
 * target elsewhere in the same query, by interpolating it again, silently
 * re-emits its FIRST (here: unqualified) rendering instead of re-qualifying
 * it for wherever it's reused — safe with plain literal SQL text instead,
 * which is never rendered by drizzle at all. Only actual VALUES
 * (`personId`, the two limits) are `${}`-interpolated, as bound parameters,
 * never column identifiers.
 *
 * `combineOpenAndDoneTasks` (@/lib/contacts/timelineTasks) still does the
 * final open-then-done concatenation, unchanged — this function only
 * changed HOW the two groups are fetched (one query instead of two), not
 * the shape it hands them off in.
 */
export async function getTasksForPerson(personId: string): Promise<TasksForPerson> {
  const rawRows = await db.execute<TaskWindowRow>(sql`
    with ranked as (
      select
        task.id as "id",
        task.lead_id as "leadId",
        task.company_key as "companyKey",
        task.contact_id as "contactId",
        task.person_id as "personId",
        task.actor_bd_id as "actorBdId",
        task.assigned_to_bd_id as "assignedToBdId",
        task.title as "title",
        task.description as "description",
        task.status as "status",
        task.due_at as "dueAt",
        task.created_at as "createdAt",
        task.updated_at as "updatedAt",
        bd.name as "assignedToName",
        person.first_name as "subjectPersonFirstName",
        person.last_name as "subjectPersonLastName",
        person.company as "subjectPersonCompany",
        company.display_name as "subjectCompanyName",
        (row_number() over (
          partition by task.status
          order by
            case when task.status = 'open' then task.due_at end asc nulls last,
            case when task.status = 'open' then task.created_at end desc,
            case when task.status = 'done' then task.updated_at end desc
        ))::int as "rn",
        (count(*) over (partition by task.status))::int as "statusCount"
      from task
      left join bd on bd.id = task.assigned_to_bd_id
      left join person on person.id = task.person_id
      left join company on company.company_key = task.company_key
      where task.person_id = ${personId} and task.status in ('open', 'done')
    )
    select * from ranked
    where (status = 'open' and rn <= ${OPEN_TASKS_FOR_PERSON_LIMIT})
       or (status = 'done' and rn <= ${DONE_TASKS_FOR_PERSON_LIMIT})
    order by rn
  `);

  const byRn = (a: TaskWindowRow, b: TaskWindowRow) => a.rn - b.rn;
  const openRows = rawRows.filter((r) => r.status === "open").sort(byRn).map(toTaskRow);
  const doneRows = rawRows.filter((r) => r.status === "done").sort(byRn).map(toTaskRow);
  const openCount = rawRows.find((r) => r.status === "open")?.statusCount ?? 0;
  const doneCount = rawRows.find((r) => r.status === "done")?.statusCount ?? 0;

  return {
    rows: combineOpenAndDoneTasks(openRows, doneRows),
    openCount,
    doneCount,
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

// The general-purpose `updateTask`/`completeTask`/`setTaskStatusForPerson`
// helpers that used to live here were replaced by `updateTaskWithActivity`/
// `setTaskStatusChecked` (src/lib/tasks/updateWithActivity.ts) — see the doc
// comment above `deleteTask` below. Neither the "Editar tarea" dialog nor
// any completion/reopen entry point ever reassigns a task's subject (mockup
// decision: "Asociado con" is read-only), so the identity dual-write
// re-resolution `updateTask` used to do on a subject change has no caller
// left; `createTask` above still does its own (initial-subject) resolution.

/**
 * Task completion/reopening (and its authorization + activity logging) now
 * lives in ONE place, `setTaskStatusChecked` (src/lib/tasks/
 * updateWithActivity.ts) — replacing this file's old `completeTask` (a
 * plain, unscoped `WHERE id = taskId` update) and `setTaskStatusForPerson`
 * (scoped by a caller-supplied `personId`, which couldn't handle a task
 * shown on a Company's page that's actually person-scoped — see
 * updateWithActivity.ts's doc comment). Every former caller
 * (contacts/actions.ts, companies/actions.ts, tasks/CompleteTaskButton.tsx)
 * now goes through `setTaskStatusAction` (tasks/actions.ts) instead.
 */

export async function deleteTask(taskId: string): Promise<void> {
  await db.delete(task).where(eq(task.id, taskId));
}

/**
 * Plain read by id — used by `getTaskCompletionInfoAction` (tasks/actions.ts,
 * review fix WARNING #3) to derive the task's OWN subject/authorization
 * inputs itself, instead of trusting a client-supplied `subject`. Read-only,
 * so no `FOR UPDATE` lock (contrast `loadTaskForUpdate`,
 * src/lib/tasks/updateWithActivity.ts, used by the write paths).
 */
export async function getTaskById(taskId: string): Promise<Task | null> {
  const [row] = await db.select().from(task).where(eq(task.id, taskId));
  return row ?? null;
}

/**
 * "Completada el … · <nombre>" caption (task-edit change, mockup decision
 * 5) — the most recent `task_completed` activity row for this task, if any.
 * `null` for a task completed before this feature shipped (no such activity
 * row exists yet) — the dialog falls back to a date-only caption using the
 * task's own `updatedAt` in that case (see EditTaskDialog.tsx), never a
 * crash or a fabricated actor.
 *
 * Scoped by the task's own subject (`personId`/`companyKey`) before the
 * `metadata->>'taskId'` match, so this hits `activity_person_idx`/
 * `activity_company_idx` first — the JSONB match only narrows an already
 * small, indexed result set, never a full-table scan. Called on-demand when
 * the edit dialog opens for an already-completed task (never from a record
 * page's own render — see PERFORMANCE.md "round trips are the budget").
 */
export async function getTaskCompletionInfo(
  taskId: string,
  subject: { personId?: string | null; companyKey?: string | null },
): Promise<{ at: Date; byName: string | null } | null> {
  const subjectCondition = subject.personId
    ? eq(activity.personId, subject.personId)
    : subject.companyKey
      ? eq(activity.companyKey, subject.companyKey)
      : undefined;
  if (!subjectCondition) return null;

  const [row] = await db
    .select({ at: activity.createdAt, byName: bd.name })
    .from(activity)
    .leftJoin(bd, eq(bd.id, activity.actorBdId))
    .where(
      and(
        subjectCondition,
        eq(activity.type, "task_completed"),
        sql`${activity.metadata}->>'taskId' = ${taskId}`,
      ),
    )
    .orderBy(desc(activity.createdAt))
    .limit(1);
  return row ?? null;
}
