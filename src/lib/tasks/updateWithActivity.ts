/**
 * The task-edit change's write paths: editing a task's fields, and
 * completing/reopening it — both from ANY entry point (the "Editar tarea"
 * dialog, a list checkbox, the record page's Tareas card, the timeline's
 * "Marcar como hecha"/"Reabrir"). Both write the task UPDATE and its
 * `activity` row in ONE transaction, and both authorize through the single
 * `assertTaskAuthorized` rule (src/lib/tasks/authorization.ts) applied to
 * the task's OWN real subject — read fresh here by `id`, never trusted from
 * the caller's page context. That's what fixes the known IDOR
 * (`completeCompanyTaskAction` used to call the unscoped `completeTaskAction`)
 * for every entry point at once, and it also handles a task shown on a
 * Company's page that's actually person-scoped (`getCompanyOpenTasks` joins
 * in every open task belonging to one of the company's contacts, not just
 * `company_key`-scoped ones) — scoping the WHERE by the row's own
 * `person_id`/`company_key` instead of the caller's is correct for both
 * shapes, uniformly.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, task, type NewTask, type Task } from "@/db/schema";
import { assertContactEditableById } from "@/lib/contacts/queries";
import { listOwnerOptions } from "@/lib/contacts/bulkOwnerDb";
import { recomputePersonStatus } from "@/lib/status/recompute";
import { assertTaskAuthorized, type TaskAuthActor } from "@/lib/tasks/authorization";
import { resolveTaskAssignee, InvalidAssigneeError } from "@/lib/tasks/assignee";
import { assertAssigneeExists, createTask } from "@/lib/tasks/queries";
import { TaskNotFoundError } from "@/lib/tasks/errors";
import { isTaskStatusNoOp } from "@/lib/tasks/statusChange";
import { diffTaskEdit, type TaskEditSnapshot } from "@/lib/tasks/taskEditDiff";
import { formatTaskDueDate } from "@/lib/tasks/argentinaDate";
import { buildTaskActivityRow } from "@/lib/tasks/taskActivityBody";

/**
 * Reads the task row `FOR UPDATE`, inside the caller's transaction — review
 * fix (WARNING #2): a plain pre-transaction `SELECT` let a concurrent editor
 * change the row between that read and this write, so both the
 * authorization decision and the diff's "from" values could be stale by the
 * time the UPDATE ran. Locking it here (same `.for("update")` pattern
 * src/lib/identity/mergeDb.ts already uses for its own read-modify-write)
 * means every read below — authorization, the diff snapshot, the activity
 * metadata — comes from the row as it exists at write time, not before it.
 */
async function loadTaskForUpdate(tx: DbTx, taskId: string): Promise<Task> {
  const [row] = await tx.select().from(task).where(eq(task.id, taskId)).for("update");
  if (!row) throw new TaskNotFoundError();
  return row;
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Re-checks the row's OWN subject in the UPDATE's WHERE clause — defense in
 * depth alongside the `assertTaskAuthorized` check above it, same pattern
 * `setTaskStatusForPerson` established. */
function subjectMatch(row: Task) {
  if (row.personId) return eq(task.personId, row.personId);
  if (row.companyKey) return eq(task.companyKey, row.companyKey);
  return sql`true`;
}

function formatDueAtOrNull(dueAt: Date | null): string | null {
  return dueAt ? formatTaskDueDate(dueAt) : null;
}

async function buildNameLookup(): Promise<(bdId: string | null) => string | null> {
  const options = await listOwnerOptions();
  const nameById = new Map(options.map((o) => [o.id, o.name]));
  return (bdId) => (bdId ? (nameById.get(bdId) ?? null) : null);
}

/**
 * Creates a task and its `task_created` activity in ONE transaction, so the
 * record's timeline can always show who set the follow-up up and a failed
 * activity write never leaves a task behind (or the reverse). The subject on
 * the activity is the inserted row's own, so it is right even when
 * `person_id` was resolved by the identity dual-write lookup.
 */
export async function createTaskWithActivity(input: NewTask, me: TaskAuthActor): Promise<Task> {
  return db.transaction(async (tx) => {
    const created = await createTask(input, tx);
    await tx
      .insert(activity)
      .values(buildTaskActivityRow("task_created", created, me.id, { taskId: created.id, taskTitle: created.title }));
    // Same "every activity insert recomputes status in its own transaction"
    // contract as the other task writes (task_created is a non-touch type).
    if (created.personId) await recomputePersonStatus(tx, created.personId);
    return created;
  });
}

export interface TaskEditInput {
  title: string;
  dueAt: Date | null;
  /** Raw `<select>` value — resolved the same way createTaskAction resolves
   * it (blank means "assign it to me"). */
  assignedToBdId: string;
  description: string | null;
}

/**
 * Applies the "Editar tarea" dialog's save. Diffs against the task's
 * CURRENT row (read fresh here, not trusted from the dialog's props) and
 * writes ONE `task_updated` activity row in the same transaction as the
 * UPDATE — only when at least one field actually changed (mockup decision:
 * "no changes: no write and no activity").
 */
export async function updateTaskWithActivity(
  taskId: string,
  me: TaskAuthActor,
  edits: TaskEditInput,
): Promise<Task> {
  // Assignee validation has no dependency on the locked row (it only checks
  // the SUBMITTED assignee id against real `bd` rows) and no side effect on
  // it, so it runs before the transaction opens, same ordering
  // createTaskAction already uses.
  const assignedToBdId = resolveTaskAssignee(edits.assignedToBdId, me.id);
  if (assignedToBdId === undefined) throw new InvalidAssigneeError();
  await assertAssigneeExists(assignedToBdId, me.id);
  const nameOf = await buildNameLookup();

  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId);
    // Authorization re-checked against the LOCKED row (WARNING #2): a task
    // reassigned to a different BD/subject between the dialog opening and
    // this save must be authorized against what it belongs to NOW, not what
    // it belonged to when the dialog was opened.
    await assertTaskAuthorized(current, me, assertContactEditableById);

    const before: TaskEditSnapshot = {
      title: current.title,
      dueAt: current.dueAt,
      assignedToBdId: current.assignedToBdId,
      description: current.description,
    };
    const after: TaskEditSnapshot = {
      title: edits.title,
      dueAt: edits.dueAt,
      assignedToBdId,
      description: edits.description,
    };
    const changes = diffTaskEdit(before, after, formatDueAtOrNull, nameOf);
    if (changes.length === 0) return current;

    const [updated] = await tx
      .update(task)
      .set({
        title: after.title,
        dueAt: after.dueAt,
        assignedToBdId,
        description: after.description,
        updatedAt: new Date(),
      })
      .where(and(eq(task.id, taskId), subjectMatch(current)))
      .returning();
    if (!updated) throw new TaskNotFoundError();

    await tx
      .insert(activity)
      .values(buildTaskActivityRow("task_updated", current, me.id, { taskId: current.id, taskTitle: updated.title, changes }));
    // Never counts as a contact touch (deriveStatus.ts has no case for
    // `task_updated` — see tests/unit/deriveStatus.test.ts) — recomputing
    // anyway keeps this write on the exact same "every activity insert
    // recomputes status in its own transaction" contract every other write
    // here follows, so a future status rule change can't silently diverge
    // for task activity without a test catching it first.
    if (current.personId) await recomputePersonStatus(tx, current.personId);

    return updated;
  });
}

/**
 * Completes or reopens a task from ANY entry point — the dialog's own
 * button, a list/card checkbox, or the timeline's "Marcar como hecha"/
 * "Reabrir" — always through this one function, so every entry point
 * authorizes, scopes and logs identically. Asking for the status the task
 * already has is a no-op: no UPDATE and no activity.
 */
export async function setTaskStatusChecked(
  taskId: string,
  status: "open" | "done",
  me: TaskAuthActor,
): Promise<Task> {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId);
    await assertTaskAuthorized(current, me, assertContactEditableById);
    // Already in the requested status (a stale checkbox, a double click on a
    // done row): nothing changed, so nothing is written and no activity
    // claims otherwise. Checked AFTER authorization so it never leaks a task
    // the caller may not touch.
    if (isTaskStatusNoOp(current.status, status)) return current;

    const [updated] = await tx
      .update(task)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(task.id, taskId), subjectMatch(current)))
      .returning();
    if (!updated) throw new TaskNotFoundError();

    await tx
      .insert(activity)
      .values(
        buildTaskActivityRow(status === "done" ? "task_completed" : "task_reopened", current, me.id, {
          taskId: current.id,
          taskTitle: updated.title,
        }),
      );
    if (current.personId) await recomputePersonStatus(tx, current.personId);

    return updated;
  });
}
