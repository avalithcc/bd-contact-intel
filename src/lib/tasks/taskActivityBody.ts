/**
 * Pure body-text formatter for the four task activity types:
 * `task_created`, `task_updated`, `task_completed`, `task_reopened`. Shared by the
 * Contact timeline (src/lib/contacts/timelineEntryBody.ts) and the Company
 * timeline (src/lib/companies/timelineView.ts) so the copy can never drift
 * between the two record pages.
 *
 * `metadata.changes` is exactly what updateWithActivity.ts writes to the
 * `task_updated` row's `metadata.changes` (see taskEditDiff.ts's
 * `TaskFieldChange`) — already display-ready strings, never raw ids or
 * timestamps, so this never needs a database read to render.
 */

export interface TaskActivityChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface TaskActivityMetadata {
  taskId?: string;
  taskTitle?: string;
  changes?: TaskActivityChange[];
}

export interface TaskActivityBodyLabels {
  fieldTitle: string;
  fieldDue: string;
  fieldAssignee: string;
  fieldDescription: string;
  // Owner decision (2026-09-29): any BD may edit/complete/reopen any task,
  // so the timeline entry itself must name WHO did it — e.g. "Macarena
  // editó la tarea «X»: …" — not just describe what changed. These three
  // are lowercase verb phrases meant to follow an actor's name, never a
  // sentence start on their own.
  updatedPrefix: string;
  completedPrefix: string;
  reopenedPrefix: string;
  /** Actor fallback when `actorBdId` pointed at a since-deleted `bd` row
   * (`onDelete: "set null"`) — `actorBdId` itself is always set at write
   * time (see buildTaskActivityRow), this only covers that later edge case. */
  unknownActor: string;
  /** Lowercase verb phrase for `task_created`, like the three above. */
  createdPrefix: string;
}

const FIELD_LABEL_KEY: Record<string, keyof TaskActivityBodyLabels> = {
  title: "fieldTitle",
  dueAt: "fieldDue",
  assignedToBdId: "fieldAssignee",
  description: "fieldDescription",
};

const EMPTY_VALUE = "—";

export function taskActivityBody(
  type: string,
  metadata: TaskActivityMetadata,
  actorName: string | null,
  l: TaskActivityBodyLabels,
): string {
  const title = metadata.taskTitle ?? "";
  const actor = actorName ?? l.unknownActor;

  if (type === "task_created") return `${actor} ${l.createdPrefix} «${title}»`;
  if (type === "task_completed") return `${actor} ${l.completedPrefix} «${title}»`;
  if (type === "task_reopened") return `${actor} ${l.reopenedPrefix} «${title}»`;

  if (type === "task_updated") {
    const parts = (metadata.changes ?? []).map((change) => {
      const key = FIELD_LABEL_KEY[change.field];
      const label = key ? l[key] : change.field;
      return `${label} ${change.from ?? EMPTY_VALUE} → ${change.to ?? EMPTY_VALUE}`;
    });
    return `${actor} ${l.updatedPrefix} «${title}»: ${parts.join(" · ")}`;
  }

  return "";
}

/** Every `activity.type` a task write produces. The other lists that must
 * know them (timeline types, the Tareas pill, non-touch types) are pinned to
 * this one by tests/unit/taskActivityBody.test.ts. */
export const ALL_TASK_ACTIVITY_TYPES = ["task_created", "task_updated", "task_completed", "task_reopened"] as const;

export type TaskActivityType = (typeof ALL_TASK_ACTIVITY_TYPES)[number];

export interface TaskActivitySubject {
  personId: string | null;
  companyKey: string | null;
}

/**
 * Pure builder for the `activity` row `updateWithActivity.ts` inserts for
 * all four task activity types — pulled out so "every task activity row
 * sets `actorBdId`" (owner decision 2026-09-29: any BD may edit/complete/
 * reopen any task, but the system must record WHO did it) is a single,
 * unit-tested construction site instead of four separate object literals
 * that could drift. `actorBdId` is a required (non-optional) parameter,
 * never omitted — see tests/unit/taskActivityBody.test.ts.
 */
export function buildTaskActivityRow(
  type: TaskActivityType,
  subject: TaskActivitySubject,
  actorBdId: string,
  metadata: TaskActivityMetadata,
): { type: TaskActivityType; personId: string | null; companyKey: string | null; actorBdId: string; metadata: TaskActivityMetadata } {
  return {
    type,
    personId: subject.personId,
    companyKey: subject.companyKey,
    actorBdId,
    metadata,
  };
}
