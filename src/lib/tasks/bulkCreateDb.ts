/**
 * DB glue for the bulk "Crear tarea" action (task-essentials backlog:
 * "one set-based insert instead of a per-contact loop" in
 * bulkCreateTaskAction, src/app/(app)/contacts/bulkActions.ts). Not
 * unit-tested directly (imports `db`) — buildBulkTaskRows/
 * assertBulkTaskRowCountWithinCap (bulkCreate.ts) carry the tested logic,
 * same split as bulkOwner.ts/bulkOwnerDb.ts.
 *
 * Fix: the old version called `createTask` once per selected person inside
 * a `for` loop — N INSERT round trips for N selected contacts (measured:
 * ~222ms/round trip, PERFORMANCE.md), serialized (a bulk write is not a
 * candidate for `Promise.all` either — see PERFORMANCE.md's "does this
 * remove round trips, or just reorder them?"). This does the same write —
 * merged-away persons excluded, one row per remaining person, all sharing
 * the same title/description/dueAt/assignee — as ONE multi-row `INSERT`,
 * inside ONE transaction with the "still live" filter, so the two can never
 * observe different snapshots of `person.merged_into_id` (a person merged
 * away between the filter and the insert would otherwise still get a task).
 *
 * One `task_created` activity per created task is written in the same
 * transaction as ONE multi-row INSERT (so the whole call is: live-person
 * filter, assignee name, task insert, activity insert, never a per-contact
 * statement). `task_created` is status-neutral and a non-touch type, so no
 * status recompute is needed (a recompute would read every selected contact's
 * whole activity history).
 */
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { activity, person, task } from "@/db/schema";
import { loadBdNames } from "@/lib/tasks/assigneeNames";
import { buildTaskActivityRow, buildTaskCreatedMetadata } from "@/lib/tasks/taskActivityBody";
import {
  assertBulkTaskRowCountWithinCap,
  buildBulkTaskRows,
  type BulkTaskSharedFields,
} from "@/lib/tasks/bulkCreate";

/**
 * Creates one task per still-live person in `personIds` (merged-away
 * persons are silently excluded, same "never write to a merged person"
 * rule `bulkAssignOwner` follows — src/lib/contacts/bulkOwnerDb.ts). Caller
 * validates `assignedToBdId` via `assertAssigneeExists` BEFORE calling this
 * (same ordering `updateTaskWithActivity` uses: assignee validation has no
 * dependency on this write and no side effect on it).
 *
 * Returns the number of tasks actually created (may be less than
 * `personIds.length` if some were merged away — the caller reports this
 * count back to the user, same as the old per-row loop's `created` counter).
 *
 * `personIds` must already be capped by the caller (resolveBulkTargetIds:
 * MAX_BULK_SELECTION for a checked-boxes selection, BULK_FILTER_TARGET_CAP
 * for "Seleccionar los N" filter-wide mode — src/lib/contacts/bulkOwner.ts) —
 * `assertBulkTaskRowCountWithinCap` is a defense-in-depth re-check, not the
 * primary enforcement point.
 */
export async function bulkCreateTasks(
  personIds: readonly string[],
  fields: BulkTaskSharedFields,
  database: typeof db = db,
): Promise<number> {
  assertBulkTaskRowCountWithinCap(personIds.length);
  if (!personIds.length) return 0;

  return database.transaction(async (tx) => {
    const liveRows = await tx
      .select({ id: person.id })
      .from(person)
      .where(and(inArray(person.id, [...personIds]), isNull(person.mergedIntoId)));
    if (!liveRows.length) return 0;

    const rows = buildBulkTaskRows(
      liveRows.map((r) => r.id),
      fields,
    );
    const created = await tx.insert(task).values(rows).returning();
    const names = await loadBdNames(tx, [fields.assignedToBdId]);
    const assigneeName = names.get(fields.assignedToBdId) ?? null;
    await tx
      .insert(activity)
      .values(created.map((t) => buildTaskActivityRow("task_created", t, fields.actorBdId, buildTaskCreatedMetadata(t, assigneeName))));
    return created.length;
  });
}
