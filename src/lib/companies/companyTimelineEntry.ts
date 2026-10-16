/**
 * Pure per-row mapping for `getCompanyTimeline` (recordQueries.ts) — split
 * out so it's unit-testable without a database, same split convention as
 * src/lib/activity/timelineEntry.ts (the Contact record's equivalent).
 *
 * `at` is `effectiveActivityAtSql()`'s value: `null` for a
 * NON_TOUCH_ACTIVITY_TYPES row (the task types in ALL_TASK_ACTIVITY_TYPES, src/lib/tasks/taskActivityBody.ts —
 * see src/lib/contacts/effectiveActivityTime.ts). A non-touch row still
 * needs SOME time to render in the company timeline, so `createdAt` falls
 * back to `rawCreatedAt` (the row's own `activity.created_at`) — it just
 * must never sort as the newest touch (recordQueries.ts's `ORDER BY ...
 * NULLS LAST` handles that half) or display as epoch 1970 (`new
 * Date(null)`, the bug this guards against).
 */
import { parseDbTimestamp } from "@/lib/db/timestamp";
import { withholdDeletedMetadata } from "@/lib/activity/noteDelete";

export interface CompanyTimelineRawRow {
  id: string;
  type: string;
  at: Date | string | null;
  rawCreatedAt: Date | string;
  metadata: unknown;
  actorBdId: string | null;
  personId: string | null;
  deletedAt?: Date | string | null;
  deletedByBdId?: string | null;
}

export interface CompanyTimelineEntry {
  id: string;
  type: string;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
  // Raw actor id (fresh-review BLOCKER fix, 2026-09-30) — needed by
  // buildCompanyTimelineViewRows to run isTimelineEntryVisible against the
  // viewer, the same privacy check the contact timeline already applies.
  // `actorName` alone can't answer "is this MY row" without also knowing
  // the id it resolved from.
  actorBdId: string | null;
  actorName: string | null;
  personId: string | null;
  personName: string | null;
  scope: "company" | "contact";
  /** Set for a soft-deleted Contact note: the tab renders a tombstone from this (NoteTombstone), never the text. */
  deleted: { at: Date; byBdId: string | null; byName: string | null; byIsAdmin: boolean } | null;
}

export function buildCompanyTimelineEntry(
  row: CompanyTimelineRawRow,
  personNameById: ReadonlyMap<string, string | null>,
  actorNameById: ReadonlyMap<string, string | null>,
  adminIds: ReadonlySet<string>,
): CompanyTimelineEntry {
  const deletedAt = row.deletedAt ? parseDbTimestamp(row.deletedAt) : null;
  return {
    id: row.id,
    type: row.type,
    createdAt: row.at !== null ? parseDbTimestamp(row.at) : parseDbTimestamp(row.rawCreatedAt),
    metadata: withholdDeletedMetadata(row.metadata as Record<string, unknown> | null, deletedAt),
    actorBdId: row.actorBdId,
    actorName: row.actorBdId ? (actorNameById.get(row.actorBdId) ?? null) : null,
    personId: row.personId,
    personName: row.personId ? (personNameById.get(row.personId) ?? null) : null,
    scope: row.personId ? "contact" : "company",
    deleted: deletedAt
      ? {
          at: deletedAt,
          byBdId: row.deletedByBdId ?? null,
          byName: row.deletedByBdId ? (actorNameById.get(row.deletedByBdId) ?? null) : null,
          byIsAdmin: row.deletedByBdId ? adminIds.has(row.deletedByBdId) : false,
        }
      : null,
  };
}
