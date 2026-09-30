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
 *
 * "Tareas completadas" (`rpt_task_completions`/`rpt_tasks_pivot`) deliberately
 * does NOT use `task.updated_at` (bumped by ANY edit — a done task renamed
 * later would be re-counted on the edit's date, not the completion's) and
 * does NOT use `effectiveActivityAtSql()` (`task_completed` is one of
 * `NON_TOUCH_ACTIVITY_TYPES`, so that helper returns `NULL` for it by
 * design). The real signal is the `task_completed` activity row's own raw
 * `created_at`, joined via `(activity.metadata->>'taskId')::uuid = task.id`
 * (same join `getTaskCompletionInfo`, src/lib/tasks/queries.ts, already
 * uses). `distinct on (task.id) ... order by task.id, activity.created_at
 * desc` keeps only the LATEST completion per task — a task completed,
 * reopened, and completed again counts once, on its latest completion —
 * and `task.status = 'done'` (current status) excludes a task that was
 * later reopened entirely, matching README decision 9's "did the BD close
 * things out" meaning, not "did the BD ever mark it done at some point".
 * The pure twin of this exact rule (`pickLatestCompletion`/
 * `isCompletionCountable`, src/lib/reports/taskCompletions.ts) pins it in a
 * fast unit test with plain fixtures.
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
    -- BD filter semantics, documented per the reports-bd-filter-drilldown
    -- audit: "Descartes por motivo" is scoped by the discarded PERSON's
    -- owner (person.owner_bd_id), the same convention rpt_person_scope
    -- above and rpt_funnel's own pbc_discarded use -- never the activity's
    -- actor -- so this card's total always matches "Embudo de contactos"'s
    -- own discarded count for the identical BD filter.
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
    ),
    rpt_bd_options as (
      select bd.id as pbc_id, bd.name as pbc_name
      from ${bd}
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
      coalesce((select json_agg(json_build_object('stage', pbc_stage, 'count', pbc_count)) from rpt_pipeline), '[]'::json) as pipeline,
      coalesce((select json_agg(json_build_object('id', pbc_id, 'name', pbc_name) order by pbc_name) from rpt_bd_options), '[]'::json) as bd_options
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
    rpt_task_completions as (
      select distinct on (task.id)
        task.assigned_to_bd_id as pbc_bd_id,
        activity.created_at as pbc_completed_at
      from ${task}
      join ${activity} on activity.type = 'task_completed' and (activity.metadata->>'taskId')::uuid = task.id
      where task.status = 'done'
        and task.assigned_to_bd_id is not null
        and (${bdId}::uuid is null or task.assigned_to_bd_id = ${bdId}::uuid)
      order by task.id, activity.created_at desc
    ),
    rpt_tasks_pivot as (
      select pbc_bd_id, count(*)::int as pbc_tasks_completed
      from rpt_task_completions
      where pbc_completed_at >= ${fromIso}::timestamptz
        and pbc_completed_at < ${toIso}::timestamptz
      group by pbc_bd_id
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
  /**
   * EVERY bd row (bug fix, reports-bd-filter-drilldown): the "Filtrar por
   * BD" `<select>`'s options must never come from `perBd` (buildReportPerBdQuery's
   * OWN rows are filtered by the SAME `bdId` this query is filtered by — once
   * a BD is selected, every other BD used to disappear from the dropdown).
   * Folded into this query's own json_agg (PERFORMANCE.md: no added round
   * trip) rather than a 3rd statement.
   */
  bdOptions: { id: string; name: string }[];
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

export interface WonCompaniesDrilldownParams {
  bdId: string | null;
}

const WON_COMPANIES_DRILLDOWN_LIMIT = 500;

/**
 * "Empresas ganadas" KPI drilldown (reports-bd-filter-drilldown). BD-filtered
 * only, deliberately NOT period-filtered — see wonCompaniesDrilldown.ts's
 * doc comment for why (must stay consistent with the KPI's own decision-7
 * snapshot count). `rpt_won_at` scans `activity` scoped down to only the
 * companies already selected by `rpt_won_companies` (a correlated EXISTS,
 * rule 7), reusing the existing `activity_company_idx`/`activity_type_idx`
 * indexes rather than a full-table scan.
 */
export function buildWonCompaniesDrilldownQuery({ bdId }: WonCompaniesDrilldownParams) {
  return sql`
    with rpt_won_companies as (
      select
        company.company_key as pbc_company_key,
        company.display_name as pbc_display_name,
        company.owner_bd_id as pbc_owner_bd_id,
        company.updated_at as pbc_updated_at
      from ${company}
      where company.relationship_stage = 'won'
        and (${bdId}::uuid is null or company.owner_bd_id = ${bdId}::uuid)
    ),
    rpt_won_at as (
      select distinct on (activity.company_key)
        activity.company_key as pbc_company_key,
        activity.created_at as pbc_won_at
      from ${activity}
      where activity.type = 'status_change'
        and activity.person_id is null
        and activity.metadata->>'status' = 'won'
        and exists (select 1 from rpt_won_companies where rpt_won_companies.pbc_company_key = activity.company_key)
      order by activity.company_key, activity.created_at desc
    )
    select
      rpt_won_companies.pbc_company_key as company_key,
      rpt_won_companies.pbc_display_name as display_name,
      rpt_won_companies.pbc_owner_bd_id as owner_bd_id,
      bd.name as owner_bd_name,
      coalesce(rpt_won_at.pbc_won_at, rpt_won_companies.pbc_updated_at) as won_at,
      (rpt_won_at.pbc_won_at is not null) as won_at_exact
    from rpt_won_companies
    left join rpt_won_at on rpt_won_at.pbc_company_key = rpt_won_companies.pbc_company_key
    left join ${bd} on bd.id = rpt_won_companies.pbc_owner_bd_id
    order by won_at desc
    limit ${WON_COMPANIES_DRILLDOWN_LIMIT}
  `;
}

export type WonCompanyDrilldownRawResultRow = {
  company_key: string;
  display_name: string;
  owner_bd_id: string | null;
  owner_bd_name: string | null;
  won_at: Date | string;
  won_at_exact: boolean;
}

export interface MeetingsDrilldownParams {
  fromIso: string;
  toIso: string;
  bdId: string | null;
}

const MEETINGS_DRILLDOWN_LIMIT = 500;

/**
 * "Reuniones agendadas" KPI drilldown (reports-bd-filter-drilldown).
 * Actor-scoped (`activity.actor_bd_id`) and period-scoped
 * (`effectiveActivityAtSql()`), matching this KPI's own definition exactly —
 * see meetingsDrilldown.ts's doc comment for why this is actor-, not
 * owner-, scoped.
 */
export function buildMeetingsDrilldownQuery({ fromIso, toIso, bdId }: MeetingsDrilldownParams) {
  return sql`
    select
      activity.id as activity_id,
      person.id as person_id,
      person.first_name as person_first_name,
      person.last_name as person_last_name,
      person.company_key as company_key,
      company.display_name as company_name,
      activity.actor_bd_id as bd_id,
      bd.name as bd_name,
      ${effectiveActivityAtSql()} as meeting_at
    from ${activity}
    join ${person} on person.id = activity.person_id and person.merged_into_id is null
    left join ${company} on company.company_key = person.company_key
    left join ${bd} on bd.id = activity.actor_bd_id
    where activity.type = 'meeting_logged'
      and (${bdId}::uuid is null or activity.actor_bd_id = ${bdId}::uuid)
      and ${effectiveActivityAtSql()} >= ${fromIso}::timestamptz
      and ${effectiveActivityAtSql()} < ${toIso}::timestamptz
    order by meeting_at desc
    limit ${MEETINGS_DRILLDOWN_LIMIT}
  `;
}

export type MeetingDrilldownRawResultRow = {
  activity_id: string;
  person_id: string;
  person_first_name: string | null;
  person_last_name: string | null;
  company_key: string | null;
  company_name: string | null;
  bd_id: string | null;
  bd_name: string | null;
  meeting_at: Date | string;
}
