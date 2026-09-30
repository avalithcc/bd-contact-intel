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
 *   comment) AND whose person is not merged (matches `readQueueRows`'s own
 *   `isNull(person.mergedIntoId)` join filter — without this, a merged
 *   person could inflate the badge past what the page itself shows). Never
 *   materializes an un-materialized day (reads 0 rows -> 0 for free),
 *   matching the original function's contract.
 *
 * Schema-only import (no `@/db` client) so this stays importable — and this
 * file's own test stays runnable — without a live DATABASE_URL, same
 * convention as src/lib/followUp/candidateQuery.ts. `activity` is left
 * UNALIASED (rule 4/PgDialect render test below); the "worked today" time
 * expression below is therefore written with LITERAL `activity.`-qualified
 * SQL text (not `${activity.column}` interpolation) — PERFORMANCE.md's
 * documented Drizzle 0.36.4 gotcha: `activity` is already interpolated bare
 * as this subquery's `FROM ${activity}` target, so reusing the SAME column
 * reference via `${activity.column}` a second time inside this NESTED
 * correlated subquery would silently re-emit its earlier unqualified
 * rendering instead of table-qualifying it, making the correlation always
 * resolve inside the wrong scope. `queueSelection.ts#workedTodayAtSql()`
 * (which DOES use `${activity.column}` interpolation, safe there because
 * it is never nested inside another query that already bare-interpolated
 * `activity`) is NOT reused here for that reason — this file inlines the
 * equivalent CASE as raw text instead, kept in sync by
 * tests/unit/queueSelection.test.ts and this file's own tests both pinning
 * the same `call`-excluded, `email_sent`/`reply_received`-only rule.
 */
import { sql } from "drizzle-orm";
import { activity, followUpQueueItem, person, task } from "@/db/schema";
import { WORKED_ACTIVITY_TYPES } from "@/lib/followUp/queueSelection";

/** Raw-SQL-text twin of queueSelection.ts#workedTodayAtSql() — see this file's doc comment for why it can't reuse that helper via interpolation here. */
const WORKED_TODAY_AT_SQL_TEXT = `(case
            when activity.type = 'call' then activity.created_at
            when activity.type in ('email_sent', 'reply_received') and (activity.metadata->>'occurredAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (activity.metadata->>'occurredAt')::timestamptz
            else activity.created_at end)`;

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
          -- Fresh-review fix: without this, a merged person still counted
          -- toward the badge while readQueueRows (queueQueries.ts) already
          -- hides them from the page itself -- the badge said 3, the page
          -- showed 2. Same "merged persons are hidden from every read"
          -- guard (design D1/D6) as that function's own isNull(person.
          -- mergedIntoId) join filter.
          and exists (
            select 1 from ${person}
            where person.id = follow_up_queue_item.person_id
              and person.merged_into_id is null
          )
          and not exists (
            select 1 from ${activity}
            where activity.person_id = follow_up_queue_item.person_id
              and activity.type in (${workedTypes})
              and ${sql.raw(WORKED_TODAY_AT_SQL_TEXT)} >= ${todayStartUtcIso}::timestamptz
              and ${sql.raw(WORKED_TODAY_AT_SQL_TEXT)} < ${tomorrowStartUtcIso}::timestamptz
          )
      ) as follow_up_count
  `;
}
