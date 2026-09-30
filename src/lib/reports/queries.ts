/**
 * /admin/reports's two round trips (PERFORMANCE.md: "round trips are the
 * budget" — every card on this page comes from exactly these two
 * statements, never one query per card). Query builders are schema-only
 * exports (no `@/db`), so they stay importable/testable without a live
 * DATABASE_URL (PgDialect render tests: tests/unit/reportsQueries.test.ts),
 * same convention as appShellBadgeCountsQuery.ts.
 *
 * Every nullable "BD filter" clause uses the SAME shape,
 * `(${bdId}::uuid is null or <column> = ${bdId}::uuid)`, so passing `null`
 * (the "Todos los BDs" option) renders one fixed query text regardless of
 * whether a BD is selected — no conditional SQL branching to keep in sync.
 *
 * `activity` is bare-interpolated as a FROM target in BOTH
 * `rpt_discard_reasons` (query 1) and `rpt_activity_pivot` (query 2) — per
 * PERFORMANCE.md's documented Drizzle 0.36.4 gotcha, the queue pivot's own
 * nested correlated EXISTS therefore reuses `workedTodayAtSql()`'s rule as
 * LITERAL SQL text (`WORKED_AT_SQL_TEXT` below), not via `${activity.col}`
 * interpolation, mirroring appShellBadgeCountsQuery.ts's own documented
 * workaround. `effectiveActivityAtSql()` itself is safe to call fresh
 * multiple times in the same statement (it builds a new tree per call).
 */
import { sql } from "drizzle-orm";
import { activity, bd, company, followUpQueueItem, person, task } from "@/db/schema";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";

const ACTIVITY_BY_BD_TYPES = ["note", "call", "meeting_logged", "email_sent", "reply_received"] as const;

/** Literal-text twin of queueSelection.ts#workedTodayAtSql(), generalized from "today" to an arbitrary ART calendar date — see this file's doc comment for why it can't reuse that helper via interpolation here. */
const WORKED_AT_SQL_TEXT = `(case
            when activity.type = 'call' then activity.created_at
            when activity.type in ('email_sent', 'reply_received') and (activity.metadata->>'occurredAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (activity.metadata->>'occurredAt')::timestamptz
            else activity.created_at end)`;
const WORKED_ACTIVITY_TYPE_LIST = ["note", "call", "meeting_logged", "email_sent", "discarded"] as const;

export interface ReportAggregatesParams {
  fromIso: string;
  toIso: string;
  bdId: string | null;
}

export function buildReportAggregatesQuery({ fromIso, toIso, bdId }: ReportAggregatesParams) {
  return sql`
    with rpt_person_scope as (
      select person.id, person.status, person.source_key
      from ${person}
      where person.merged_into_id is null
        and person.created_at >= ${fromIso}::timestamptz
        and person.created_at < ${toIso}::timestamptz
        and (${bdId}::uuid is null or person.owner_bd_id = ${bdId}::uuid)
    ),
    rpt_funnel as (
      select
        count(*)::int as pbc_new_total,
        count(*) filter (where rpt_person_scope.status in ('contacted','replied','meeting'))::int as pbc_contacted_or_more,
        count(*) filter (where rpt_person_scope.status in ('replied','meeting'))::int as pbc_replied_or_more,
        count(*) filter (where rpt_person_scope.status = 'meeting')::int as pbc_meeting,
        count(*) filter (where rpt_person_scope.status = 'discarded')::int as pbc_discarded
      from rpt_person_scope
    ),
    rpt_source_status as (
      select rpt_person_scope.source_key as pbc_source_key, rpt_person_scope.status as pbc_status, count(*)::int as pbc_count
      from rpt_person_scope
      group by rpt_person_scope.source_key, rpt_person_scope.status
    ),
    rpt_discard_reasons as (
      select coalesce(activity.metadata->>'reason', '') as pbc_reason, count(*)::int as pbc_count
      from ${activity}
      join person on person.id = activity.person_id
      where activity.type = 'discarded'
        and person.merged_into_id is null
        and (${bdId}::uuid is null or person.owner_bd_id = ${bdId}::uuid)
        and ${effectiveActivityAtSql()} >= ${fromIso}::timestamptz
        and ${effectiveActivityAtSql()} < ${toIso}::timestamptz
      group by coalesce(activity.metadata->>'reason', '')
    ),
    rpt_pipeline as (
      select company.relationship_stage as pbc_stage, count(*)::int as pbc_count
      from ${company}
      where (${bdId}::uuid is null or company.owner_bd_id = ${bdId}::uuid)
      group by company.relationship_stage
    )
    select
      (select json_build_object(
        'newTotal', pbc_new_total,
        'contactedOrMore', pbc_contacted_or_more,
        'repliedOrMore', pbc_replied_or_more,
        'meeting', pbc_meeting,
        'discarded', pbc_discarded
      ) from rpt_funnel) as funnel,
      coalesce((select json_agg(json_build_object('sourceKey', pbc_source_key, 'status', pbc_status, 'count', pbc_count)) from rpt_source_status), '[]'::json) as source_status,
      coalesce((select json_agg(json_build_object('reason', pbc_reason, 'count', pbc_count)) from rpt_discard_reasons), '[]'::json) as discard_reasons,
      coalesce((select json_agg(json_build_object('stage', pbc_stage, 'count', pbc_count)) from rpt_pipeline), '[]'::json) as pipeline
  `;
}

export interface ReportPerBdParams {
  fromIso: string;
  toIso: string;
  /** ART calendar dates (`follow_up_queue_item.queue_date` is a plain `date` column). */
  fromDate: string;
  toDateExclusive: string;
  bdId: string | null;
}

export function buildReportPerBdQuery({ fromIso, toIso, fromDate, toDateExclusive, bdId }: ReportPerBdParams) {
  const activityTypes = sql.join(
    ACTIVITY_BY_BD_TYPES.map((t) => sql`${t}`),
    sql`, `,
  );
  const workedTypes = sql.join(
    WORKED_ACTIVITY_TYPE_LIST.map((t) => sql`${t}`),
    sql`, `,
  );
  return sql`
    with rpt_activity_pivot as (
      select
        activity.actor_bd_id as pbc_bd_id,
        count(*) filter (where activity.type = 'note')::int as pbc_notes,
        count(*) filter (where activity.type = 'call')::int as pbc_calls,
        count(*) filter (where activity.type = 'meeting_logged')::int as pbc_meetings,
        count(*) filter (where activity.type = 'email_sent')::int as pbc_emails_sent,
        count(*) filter (where activity.type = 'reply_received')::int as pbc_replies_received
      from ${activity}
      where activity.actor_bd_id is not null
        and activity.type in (${activityTypes})
        and (${bdId}::uuid is null or activity.actor_bd_id = ${bdId}::uuid)
        and ${effectiveActivityAtSql()} >= ${fromIso}::timestamptz
        and ${effectiveActivityAtSql()} < ${toIso}::timestamptz
      group by activity.actor_bd_id
    ),
    rpt_tasks_pivot as (
      select task.assigned_to_bd_id as pbc_bd_id, count(*)::int as pbc_tasks_completed
      from ${task}
      where task.status = 'done'
        and task.assigned_to_bd_id is not null
        and (${bdId}::uuid is null or task.assigned_to_bd_id = ${bdId}::uuid)
        and task.updated_at >= ${fromIso}::timestamptz
        and task.updated_at < ${toIso}::timestamptz
      group by task.assigned_to_bd_id
    ),
    rpt_queue_pivot as (
      select
        follow_up_queue_item.bd_id as pbc_bd_id,
        count(*) filter (where follow_up_queue_item.state = 'postponed')::int as pbc_postponed,
        count(*) filter (where follow_up_queue_item.state = 'skipped')::int as pbc_skipped,
        count(*) filter (where follow_up_queue_item.state = 'pending' and exists (
          select 1 from ${activity}
          where activity.person_id = follow_up_queue_item.person_id
            and activity.type in (${workedTypes})
            and ${sql.raw(WORKED_AT_SQL_TEXT)} >= (follow_up_queue_item.queue_date::timestamptz + interval '3 hours')
            and ${sql.raw(WORKED_AT_SQL_TEXT)} < (follow_up_queue_item.queue_date::timestamptz + interval '1 day 3 hours')
        ))::int as pbc_worked,
        count(*) filter (where follow_up_queue_item.state = 'pending' and not exists (
          select 1 from ${activity}
          where activity.person_id = follow_up_queue_item.person_id
            and activity.type in (${workedTypes})
            and ${sql.raw(WORKED_AT_SQL_TEXT)} >= (follow_up_queue_item.queue_date::timestamptz + interval '3 hours')
            and ${sql.raw(WORKED_AT_SQL_TEXT)} < (follow_up_queue_item.queue_date::timestamptz + interval '1 day 3 hours')
        ))::int as pbc_still_pending
      from ${followUpQueueItem}
      where follow_up_queue_item.queue_date >= ${fromDate}::date
        and follow_up_queue_item.queue_date < ${toDateExclusive}::date
        and (${bdId}::uuid is null or follow_up_queue_item.bd_id = ${bdId}::uuid)
      group by follow_up_queue_item.bd_id
    )
    select
      bd.id as bd_id,
      bd.name as bd_name,
      coalesce(rpt_activity_pivot.pbc_notes, 0) as notes,
      coalesce(rpt_activity_pivot.pbc_calls, 0) as calls,
      coalesce(rpt_activity_pivot.pbc_meetings, 0) as meetings,
      coalesce(rpt_activity_pivot.pbc_emails_sent, 0) as emails_sent,
      coalesce(rpt_activity_pivot.pbc_replies_received, 0) as replies_received,
      coalesce(rpt_tasks_pivot.pbc_tasks_completed, 0) as tasks_completed,
      coalesce(rpt_queue_pivot.pbc_worked, 0) as queue_worked,
      coalesce(rpt_queue_pivot.pbc_postponed, 0) as queue_postponed,
      coalesce(rpt_queue_pivot.pbc_skipped, 0) as queue_skipped,
      coalesce(rpt_queue_pivot.pbc_still_pending, 0) as queue_still_pending
    from ${bd}
    left join rpt_activity_pivot on rpt_activity_pivot.pbc_bd_id = bd.id
    left join rpt_tasks_pivot on rpt_tasks_pivot.pbc_bd_id = bd.id
    left join rpt_queue_pivot on rpt_queue_pivot.pbc_bd_id = bd.id
    where (${bdId}::uuid is null or bd.id = ${bdId}::uuid)
    order by bd.name
  `;
}

export interface ReportAggregatesResult {
  funnel: { newTotal: number; contactedOrMore: number; repliedOrMore: number; meeting: number; discarded: number };
  sourceStatus: { sourceKey: string | null; status: string; count: number }[];
  discardReasons: { reason: string; count: number }[];
  pipeline: { stage: string | null; count: number }[];
}

export interface ReportPerBdRow {
  bdId: string;
  bdName: string;
  notes: number;
  calls: number;
  meetings: number;
  emailsSent: number;
  repliesReceived: number;
  tasksCompleted: number;
  queueWorked: number;
  queuePostponed: number;
  queueSkipped: number;
  queueStillPending: number;
}
