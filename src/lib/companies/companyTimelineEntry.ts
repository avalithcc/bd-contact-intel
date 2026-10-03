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

export interface CompanyTimelineRawRow {
  id: string;
  type: string;
  at: Date | string | null;
  rawCreatedAt: Date | string;
  metadata: unknown;
  actorBdId: string | null;
  personId: string | null;
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
}

export function buildCompanyTimelineEntry(
  row: CompanyTimelineRawRow,
  personNameById: ReadonlyMap<string, string | null>,
  actorNameById: ReadonlyMap<string, string | null>,
): CompanyTimelineEntry {
  return {
    id: row.id,
    type: row.type,
    createdAt: row.at !== null ? parseDbTimestamp(row.at) : parseDbTimestamp(row.rawCreatedAt),
    metadata: row.metadata as Record<string, unknown> | null,
    actorBdId: row.actorBdId,
    actorName: row.actorBdId ? (actorNameById.get(row.actorBdId) ?? null) : null,
    personId: row.personId,
    personName: row.personId ? (personNameById.get(row.personId) ?? null) : null,
    scope: row.personId ? "contact" : "company",
  };
}
