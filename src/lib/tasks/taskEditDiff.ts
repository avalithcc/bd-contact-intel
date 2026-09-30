/**
 * Pure diff builder behind the "Editar tarea" dialog's `task_updated`
 * activity row (task-edit change; owner spec "Activity log"). Compares the
 * task's editable fields (title, due date, assignee, description) before
 * and after a save and returns one `TaskFieldChange` per field that
 * actually changed — an empty array means "no changes: no write and no
 * activity" (the caller, updateWithActivity.ts, skips both the task UPDATE
 * and the activity INSERT when this returns `[]`).
 *
 * `formatDueAt`/`nameOf` are injected rather than imported so this module
 * stays DB-free and independently unit-testable: production callers pass
 * `formatTaskDueDate` (src/lib/tasks/argentinaDate.ts) and a name lookup
 * built from `listOwnerOptions` (src/lib/contacts/bulkOwnerDb.ts).
 */

export interface TaskEditSnapshot {
  title: string;
  dueAt: Date | null;
  assignedToBdId: string | null;
  description: string | null;
}

export type TaskEditField = "title" | "dueAt" | "assignedToBdId" | "description";

export interface TaskFieldChange {
  field: TaskEditField;
  /** Already display-ready (a formatted date, a BD name, a truncated
   * description preview) — never a raw id or a full timestamp — so the
   * timeline can render this metadata with zero extra reads. */
  from: string | null;
  to: string | null;
}

// Descriptions can be long (owner spec) — the activity log keeps a short
// preview, not the full text, so a very long note doesn't bloat every
// `task_updated` row.
const DESCRIPTION_PREVIEW_LENGTH = 60;

function truncateDescription(value: string | null): string | null {
  if (!value) return null;
  return value.length > DESCRIPTION_PREVIEW_LENGTH
    ? `${value.slice(0, DESCRIPTION_PREVIEW_LENGTH)}…`
    : value;
}

/** Comparable key for a nullable due date — two `Date` instances for the
 * same instant must compare equal, so this compares by value, not identity. */
function dueAtKey(dueAt: Date | null): string {
  return dueAt ? dueAt.toISOString() : "";
}

export function diffTaskEdit(
  before: TaskEditSnapshot,
  after: TaskEditSnapshot,
  formatDueAt: (dueAt: Date | null) => string | null,
  nameOf: (bdId: string | null) => string | null,
): TaskFieldChange[] {
  const changes: TaskFieldChange[] = [];

  if (before.title !== after.title) {
    changes.push({ field: "title", from: before.title, to: after.title });
  }

  if (dueAtKey(before.dueAt) !== dueAtKey(after.dueAt)) {
    changes.push({ field: "dueAt", from: formatDueAt(before.dueAt), to: formatDueAt(after.dueAt) });
  }

  if (before.assignedToBdId !== after.assignedToBdId) {
    changes.push({
      field: "assignedToBdId",
      from: nameOf(before.assignedToBdId),
      to: nameOf(after.assignedToBdId),
    });
  }

  if ((before.description ?? "") !== (after.description ?? "")) {
    changes.push({
      field: "description",
      from: truncateDescription(before.description),
      to: truncateDescription(after.description),
    });
  }

  return changes;
}
