/**
 * Pure per-row mapping for the Contact record's timeline pane (task 10.1;
 * bug fix, prod smoke test). Split out from queries.ts (which imports `db`)
 * so this logic — effective time + per-row visibility redaction — stays
 * unit-testable without a database, same split convention as
 * src/lib/identity/resolve.ts/resolveDb.ts.
 *
 * Bug fix: a HubSpot-imported `status_backfill` activity's real time is
 * `metadata.originalAt` (the historical time the migration reconstructs),
 * not `created_at` (when the migration ran) — getPersonTimeline previously
 * exposed only `createdAt`, so the timeline pane displayed and grouped
 * every backfill as if it happened on the import date. `at` reuses the SAME
 * rule status derivation already uses
 * (@/lib/contacts/effectiveActivityTime#resolveEffectiveActivityAt, itself
 * a thin wrapper around deriveStatus.ts#activityRowToStatusEvent), computed
 * from the row's RAW metadata (before visibility redaction below) — safe,
 * since `status_backfill` is never a conversation-content type
 * (timelineVisibility.ts), so it's always visible and its metadata is never
 * nulled.
 */
import { resolveEffectiveActivityAt } from "@/lib/contacts/effectiveActivityTime";
import { isTimelineEntryVisible } from "@/lib/activity/timelineVisibility";

export interface TimelineEntry {
  id: string;
  type: string;
  createdAt: Date;
  /** Effective time (bug fix) — Timeline.tsx and timelineGrouping.ts display, sort and group by THIS, never `createdAt`. */
  at: Date;
  actorBdId: string | null;
  actorName: string | null;
  // Redacted to null when isTimelineEntryVisible() says this viewer may not
  // see this entry's content (design R6 / admin-access-audit).
  metadata: Record<string, unknown> | null;
  visible: boolean;
}

export interface TimelineRowInput {
  id: string;
  type: string;
  createdAt: Date;
  actorBdId: string | null;
  actorName: string | null;
  metadata: unknown;
}

export function buildTimelineEntry(row: TimelineRowInput, viewerBdId: string): TimelineEntry {
  const visible = isTimelineEntryVisible({ type: row.type, actorBdId: row.actorBdId }, viewerBdId);
  const at = resolveEffectiveActivityAt({
    id: row.id,
    type: row.type,
    createdAt: row.createdAt,
    metadata: row.metadata,
  });
  return {
    id: row.id,
    type: row.type,
    createdAt: row.createdAt,
    at,
    actorBdId: row.actorBdId,
    actorName: row.actorName,
    metadata: visible ? (row.metadata as Record<string, unknown>) : null,
    visible,
  };
}
