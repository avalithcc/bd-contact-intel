/**
 * Pure row-building for the `/contacts` bulk "Crear tarea" action
 * (openspec/BACKLOG.md, task-essentials: "one set-based insert instead of a
 * per-contact loop"). Mirrors the same pure-planner/DB-glue split as bulk
 * "Asignar responsable" (src/lib/contacts/bulkOwner.ts /
 * src/lib/contacts/bulkOwnerDb.ts) — this file has no `db` import and no
 * I/O; the transactional insert lives in bulkCreateDb.ts.
 *
 * Every row shares the same title/description/dueAt/assignee/actor —
 * only `personId` varies — the same shared fields the old per-person
 * `createTask` loop passed on every iteration
 * (src/app/(app)/contacts/bulkActions.ts, pre-fix).
 *
 * Identity note: this always builds rows with `personId` already set (the
 * bulk action only ever operates on live `person` rows, never legacy
 * `contactId`/`leadId` subjects), so unlike `createTask` (src/lib/tasks/
 * queries.ts) there is no `resolvePersonIdLookup`/dual-write branch to
 * replicate here — `createTask` itself skips that branch whenever
 * `input.personId` is already set, and every bulk-created row always sets
 * it.
 */
import type { NewTask } from "@/db/schema";

/**
 * Hard ceiling for one bulk "Crear tarea" write's row count. Set to
 * `BULK_FILTER_TARGET_CAP` (src/lib/contacts/bulkOwner.ts) — the same cap
 * "Seleccionar los N" filter-wide selection already enforces upstream, so
 * this is a defense-in-depth guard, not a new user-facing limit: the
 * selection can never exceed this before it reaches `bulkCreateTasks`
 * (bulkCreateDb.ts). At 2000 rows × 6 columns, one multi-row INSERT binds
 * ~12,000 parameters — comfortably under Postgres's 65,535-parameter limit
 * per statement — so a single `INSERT ... VALUES (...), (...), ...` needs
 * no further chunking at this cap.
 */
export const MAX_BULK_TASK_ROWS = 2000;

/**
 * Throws if `count` exceeds `MAX_BULK_TASK_ROWS`. Pure/DB-free so it can be
 * unit-tested and called from `bulkCreateTasks` (bulkCreateDb.ts) before any
 * row is built.
 */
export function assertBulkTaskRowCountWithinCap(count: number): void {
  if (count > MAX_BULK_TASK_ROWS) {
    throw new RangeError(
      `bulk task creation is capped at ${MAX_BULK_TASK_ROWS} rows, got ${count}`,
    );
  }
}

export interface BulkTaskSharedFields {
  title: string;
  description?: string;
  dueAt?: Date;
  assignedToBdId: string;
  actorBdId: string;
}

/**
 * Builds one `NewTask` row per person id, all sharing `fields`. Never
 * mutates `personIds` — returns a fresh array on every call, so calling it
 * twice with the same input produces two structurally-equal-but-distinct
 * results (see tests/unit/bulkCreateTask.test.ts's "twice" test).
 */
export function buildBulkTaskRows(
  personIds: readonly string[],
  fields: BulkTaskSharedFields,
): NewTask[] {
  return personIds.map((personId) => ({
    personId,
    title: fields.title,
    description: fields.description,
    dueAt: fields.dueAt,
    assignedToBdId: fields.assignedToBdId,
    actorBdId: fields.actorBdId,
  })) as NewTask[];
}
