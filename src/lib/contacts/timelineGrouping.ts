/**
 * Pure grouping for the record page's Actividad timeline (mockup-port r03;
 * contact-record.html:107-149's "Próximas" / "{Mes} {Año}" / "Antes de la
 * migración" groups). No DB, no dictionary — the caller (Timeline.tsx)
 * supplies pre-formatted month/bucket labels.
 *
 * Grouping rule (derived from the mockup's own example: a real team note
 * dated 2 oct 2026 — BEFORE this Contact's migration on 6 oct — still
 * groups under "Octubre 2026", while a `hunter_lookup` from 20 ago 2026 and
 * a `status_backfill` from 2 jun 2026 both go to "Antes de la migración").
 * The distinguishing feature is not the date at all: `hunter_lookup` and
 * `status_backfill` are BY CONSTRUCTION pre-existing legacy-import evidence
 * (an email-finder result and a reconstructed historical status), never a
 * team member's real-time action — so those two types always bucket as
 * "Antes de la migración" regardless of date, and every other type groups
 * by the calendar month of its EFFECTIVE time (`activityRowToStatusEvent`'s
 * backfill-aware `.at`), newest month first. Open tasks with a future
 * `dueAt` always form their own "Próximas" bucket first, regardless of
 * activity.
 */
// "merge_unified" (mockup-port r08) is a synthetic entry (never a real
// `activity` row — see connectionTimelineEntries.ts's sibling pattern for
// "linkedin_sent"/"linkedin_replied") representing the migration's own
// "Unificado a partir de N registros" card; it belongs in the same bucket
// as the other legacy-import evidence.
const PRE_MIGRATION_TYPES = new Set(["hunter_lookup", "status_backfill", "merge_unified"]);
import { activityRowToStatusEvent } from "@/lib/status/deriveStatus";

export interface TimelineGroupingActivityEntry {
  id: string;
  type: string;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
}

export interface TimelineGroupingTask {
  id: string;
  dueAt: Date | null;
}

export interface TimelineGroup<T> {
  kind: "upcoming" | "month" | "pre-migration";
  // Month buckets carry the (year, month) so the caller can format the
  // label with its own locale; upcoming/pre-migration carry no monthKey.
  monthKey: string | null;
  items: T[];
}

/** `entry.at` computed alongside each grouped entry — Timeline.tsx needs it to render "el {date}". */
export interface GroupedActivityEntry<T> {
  entry: T;
  at: Date;
}

export function effectiveActivityAt(entry: TimelineGroupingActivityEntry): Date {
  return activityRowToStatusEvent({
    id: entry.id,
    type: entry.type,
    createdAt: entry.createdAt,
    metadata: entry.metadata,
  }).at;
}

function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Groups activity entries only (no tasks) — Timeline.tsx merges in the
 * "Próximas" task bucket separately since it renders very differently
 * (checkbox/"Marcar como hecha", not a `.tl-card`).
 */
export function groupTimelineEntries<T extends TimelineGroupingActivityEntry>(
  entries: readonly T[],
): TimelineGroup<GroupedActivityEntry<T>>[] {
  const withAt = entries.map((entry) => ({ entry, at: effectiveActivityAt(entry) }));
  // Newest-first within each bucket, buckets newest-first overall.
  withAt.sort((a, b) => b.at.getTime() - a.at.getTime());

  const groups: TimelineGroup<GroupedActivityEntry<T>>[] = [];
  let current: TimelineGroup<GroupedActivityEntry<T>> | null = null;

  for (const item of withAt) {
    const isPreMigration = PRE_MIGRATION_TYPES.has(item.entry.type);
    const key = isPreMigration ? "pre-migration" : monthKeyOf(item.at);
    if (!current || current.monthKey !== key || current.kind !== (isPreMigration ? "pre-migration" : "month")) {
      current = { kind: isPreMigration ? "pre-migration" : "month", monthKey: key, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }

  return groups;
}

/** Just the "Próximas" bucket — tasks with a due date, soonest first. Tasks without a due date are excluded (nothing to sort "upcoming" by). */
export function upcomingTasks<T extends TimelineGroupingTask>(tasks: readonly T[]): T[] {
  return tasks
    .filter((t): t is T & { dueAt: Date } => t.dueAt !== null)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}
