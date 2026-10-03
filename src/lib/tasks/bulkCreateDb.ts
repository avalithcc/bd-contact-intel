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
 * No `task_created` activity rows are written here, unlike a single-record
 * creation (`createTaskWithActivity`, src/lib/tasks/updateWithActivity.ts).
 * That is a known gap against the "every task change logs an activity" rule,
 * left for its own change so the bulk insert's shape is not altered here.
 */
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { person, task } from "@/db/schema";
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
): Promise<number> {
  assertBulkTaskRowCountWithinCap(personIds.length);
  if (!personIds.length) return 0;

  return db.transaction(async (tx) => {
    const liveRows = await tx
      .select({ id: person.id })
      .from(person)
      .where(and(inArray(person.id, [...personIds]), isNull(person.mergedIntoId)));
    if (!liveRows.length) return 0;

    const rows = buildBulkTaskRows(
      liveRows.map((r) => r.id),
      fields,
    );
    await tx.insert(task).values(rows);
    return rows.length;
  });
}
