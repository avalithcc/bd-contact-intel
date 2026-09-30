/**
 * Fresh-review fix: `AppLayout` used to run `getTaskBadgeCount` and
 * `getFollowUpQueueBadgeCount` as two separate sequential round trips —
 * doubling the shell's own query budget on every single page view (rule:
 * "round trips are the budget", PERFORMANCE.md). Combines both into ONE
 * statement, two independent scalar subqueries in a single `SELECT`, so the
 * shell pays exactly one round trip for both badges combined, same as
 * before this feature existed.
 *
 * Each subquery preserves the EXACT semantics of the function it replaces:
 * - `task_count`: `getTaskBadgeCount` — open tasks assigned to this BD, due
 *   (non-null `due_at`) before `tomorrowStartUtc`.
 * - `follow_up_count`: `getFollowUpQueueBadgeCount` — this BD's `pending`
 *   queue rows for today's `queue_date` that have NOT been worked today (ANY
 *   BD, not just this one — see queueQueries.ts's `workedTodayExists` doc
 *   comment). Never materializes an un-materialized day (reads 0 rows ->
 *   0 for free), matching the original function's contract.
 *
 * Schema-only import (no `@/db` client) so this stays importable — and this
 * file's own test stays runnable — without a live DATABASE_URL, same
 * convention as src/lib/followUp/candidateQuery.ts. `activity` is left
 * UNALIASED (rule 4/PgDialect render test below) even though this file
 * doesn't reuse `effectiveActivityAtSql()` — "worked today" deliberately
 * reads the raw log time, never the effective time (see queueQueries.ts).
 */
import { sql } from "drizzle-orm";
import { activity, followUpQueueItem, task } from "@/db/schema";
import { WORKED_ACTIVITY_TYPES } from "@/lib/followUp/queueSelection";

export interface AppShellBadgeCountsQueryParams {
  bdId: string;
  /** ART calendar date (`YYYY-MM-DD`) for the follow-up queue lookup. */
  queueDate: string;
  /** `getTaskBadgeCount`'s `before` boundary — tomorrow's ART calendar date at 00:00 UTC. */
  tomorrowStartUtcIso: string;
  /** ART calendar-day boundaries for "worked today" (queueQueries.ts#workedTodayExists). */
  todayStartUtcIso: string;
}

export function buildAppShellBadgeCountsQuery({
  bdId,
  queueDate,
  tomorrowStartUtcIso,
  todayStartUtcIso,
}: AppShellBadgeCountsQueryParams) {
  const workedTypes = sql.join(
    [...WORKED_ACTIVITY_TYPES].map((t) => sql`${t}`),
    sql`, `,
  );
  return sql`
    select
      (
        select count(*)::int
        from ${task}
        where task.assigned_to_bd_id = ${bdId}::uuid
          and task.status = 'open'
          and task.due_at is not null
          and task.due_at < ${tomorrowStartUtcIso}::timestamptz
      ) as task_count,
      (
        select count(*)::int
        from ${followUpQueueItem}
        where follow_up_queue_item.bd_id = ${bdId}::uuid
          and follow_up_queue_item.queue_date = ${queueDate}::date
          and follow_up_queue_item.state = 'pending'
          and not exists (
            select 1 from ${activity}
            where activity.person_id = follow_up_queue_item.person_id
              and activity.type in (${workedTypes})
              and activity.created_at >= ${todayStartUtcIso}::timestamptz
              and activity.created_at < ${tomorrowStartUtcIso}::timestamptz
          )
      ) as follow_up_count
  `;
}
