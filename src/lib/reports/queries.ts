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
import { activity, bd, company, followUpQueueItem, meeting, person, sequence, sequenceMember, task } from "@/db/schema";
import { effectiveActivityAtSql, happenedAtDisplaySql, happenedAtSql, safeTimestamptzText } from "@/lib/contacts/effectiveActivityTime";
import { notCurrentClientPersonSql } from "@/lib/reports/currentClient";
import { WON_TRACKING_STARTS_AT_ISO } from "@/lib/reports/wonTracking";
import { COHORT_STATUSES, cohortHasReplyColumns, type CohortPopulation } from "@/lib/reports/cohortDrilldown";
import { DRILLDOWN_ROW_LIMIT } from "@/lib/reports/drilldownLimit";

/**
 * SQL twin of companyBdAttribution.ts#companyBelongsToBd — see that file's
 * doc comment for the "why" (prod: both real won companies have no
 * company.owner_bd_id). References the bare `company`/`person` table names
 * (never aliased, rule 4), so every call site must FROM `${company}`
 * un-aliased, same convention `effectiveActivityAtSql()` requires of
 * `activity`. Shared by rpt_pipeline (buildReportAggregatesQuery) and
 * rpt_won_companies (buildWonCompaniesDrilldownQuery) so "Empresas ganadas"
 * and "Pipeline de empresas" can never disagree.
 */
function companyBelongsToBdSql(bdId: string | null) {
  return sql`(${bdId}::uuid is null or company.owner_bd_id = ${bdId}::uuid or exists (
    select 1 from person
    where person.company_key = company.company_key
      and person.merged_into_id is null
      and person.owner_bd_id = ${bdId}::uuid
  ))`;
}

/**
 * The date a company moved to 'won': the latest `status_change` activity (company-scoped, `person_id` null) whose
 * `metadata.status` is 'won', by the shared effective activity time. `NULL` when the company is won but no such
 * transition was ever recorded (imports, scripts and pre-2026-09 edits wrote the stage without an activity): those
 * cannot be dated, and `company.updated_at` is NOT a substitute (any edit, e.g. setting client_status, bumps it and
 * would drag the company into the current period). Moves before WON_TRACKING_STARTS_AT (wonTracking.ts: the initial
 * data load) are not real wins either. Callers count both kinds separately (`won_undated`) and cut periods at that instant. Correlated to the
 * company row, so it runs once per WON company (~60), never over the whole activity table. Call sites FROM
 * `${company}` un-aliased.
 */
function wonAtSql() {
  return sql`(select max(${effectiveActivityAtSql()}) from ${activity}
    where activity.type = 'status_change'
      and activity.person_id is null
      and activity.company_key = company.company_key
      and activity.metadata->>'status' = 'won')`;
}

/**
 * Only consumer: the `rpt_activity_pivot` type filter in buildReportPerBdQuery. `call_attempt` is the dial; it is counted
 * as EVERY dial, including one later settled into a `call` (metadata.callActivityId) and hidden from the contact timeline
 * by notFoldedAttemptSql(). That fold is a display rule and must not be applied here: a dial that became a conversation
 * is still a dial, and dropping it would break the dials-to-calls ratio the column exists to show.
 */
const ACTIVITY_BY_BD_TYPES = ["note", "call_attempt", "call", "meeting_logged", "email_sent", "reply_received"] as const;

/**
 * Midnight UTC of a queue day, as a `timestamptz`. `queue_date` is a `date`,
 * and `date::timestamptz` is midnight in the SESSION TimeZone, so the ART
 * worked-window below would move with it; `::timestamp AT TIME ZONE 'UTC'`
 * pins it explicitly (identical value while the session is UTC).
 */
const QUEUE_DAY_START_UTC_SQL_TEXT = `(follow_up_queue_item.queue_date::timestamp at time zone 'UTC')`;

/** Literal-text twin of queueSelection.ts#workedTodayAtSql(), generalized from "today" to an arbitrary ART calendar date — see this file's doc comment for why it can't reuse that helper via interpolation here. */
export const WORKED_AT_SQL_TEXT = `(case
            when activity.type = 'call' then activity.created_at
            when activity.type in ('email_sent', 'reply_received') then coalesce(${safeTimestamptzText("(activity.metadata->>'occurredAt')")}, activity.created_at)
            else activity.created_at end)`;
const WORKED_ACTIVITY_TYPE_LIST = ["note", "call", "meeting_logged", "email_sent", "discarded"] as const;

export interface ReportAggregatesParams {
  fromIso: string;
  toIso: string;
  /** Exclusive end of the FULL period for "Reuniones agendadas" (upcoming meetings are after `toIso`, which stops at now). Defaults to `toIso`. */
  scheduledToIso?: string;
  bdId: string | null;
}

/**
 * The period's cohort: non-merged persons created in the period, owner-scoped
 * when a BD is selected. Shared by `rpt_person_scope` (the funnel counts) and
 * the cohort drill-down list, so a tile and the list behind it can never
 * disagree about WHO is in scope. Everyone is in the cohort, current clients included: only the reply rate leaves them
 * out (owner decision 2026-10-19), via `rpt_person_scope.pbc_in_rate` and the drill-down's `excludeClients`.
 * Call sites FROM `${person}` un-aliased.
 */
function cohortScopeSql({ fromIso, toIso, bdId }: ReportAggregatesParams) {
  return sql`person.merged_into_id is null
        and person.created_at >= ${fromIso}::timestamptz
        and person.created_at < ${toIso}::timestamptz
        and (${bdId}::uuid is null or person.owner_bd_id = ${bdId}::uuid)`;
}

export function buildReportAggregatesQuery({ fromIso, toIso, scheduledToIso = toIso, bdId }: ReportAggregatesParams) {
  return sql`
    with rpt_person_scope as (
      select person.id, person.status, person.source_key, ${notCurrentClientPersonSql()} as pbc_in_rate
      from ${person}
      where ${cohortScopeSql({ fromIso, toIso, bdId })}
    ),
    rpt_funnel as (
      select
        count(*)::int as pbc_new_total,
        count(*) filter (where rpt_person_scope.status in ('contacted','replied','meeting'))::int as pbc_contacted_or_more,
        count(*) filter (where rpt_person_scope.status in ('replied','meeting'))::int as pbc_replied_or_more,
        count(*) filter (where rpt_person_scope.pbc_in_rate and rpt_person_scope.status in ('contacted','replied','meeting'))::int as pbc_rate_contacted,
        count(*) filter (where rpt_person_scope.pbc_in_rate and rpt_person_scope.status in ('replied','meeting'))::int as pbc_rate_replied,
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
    -- "Empresas ganadas" KPI reuses THIS count (pbc_stage = 'won'); the
    -- rollup below (companyBelongsToBdSql) is why both that KPI and this
    -- card can never disagree when filtered by BD.
    rpt_pipeline as (
      select company.relationship_stage as pbc_stage, count(*)::int as pbc_count
      from ${company}
      where ${companyBelongsToBdSql(bdId)}
      group by company.relationship_stage
    ),
    -- "Empresas ganadas" follows the period: currently-won companies whose move to 'won' (wonAtSql) falls in
    -- [from, to). Undated won companies (no recorded transition) are counted apart, never guessed into a period.
    rpt_won_period as (
      select
        count(*) filter (where rpt_won_dated.pbc_won_at >= ${WON_TRACKING_STARTS_AT_ISO}::timestamptz and rpt_won_dated.pbc_won_at >= ${fromIso}::timestamptz and rpt_won_dated.pbc_won_at < ${toIso}::timestamptz)::int as pbc_in_period,
        count(*) filter (where rpt_won_dated.pbc_won_at is null or rpt_won_dated.pbc_won_at < ${WON_TRACKING_STARTS_AT_ISO}::timestamptz)::int as pbc_undated
      from (
        select ${wonAtSql()} as pbc_won_at
        from ${company}
        where company.relationship_stage = 'won'
          and ${companyBelongsToBdSql(bdId)}
      ) as rpt_won_dated
    ),
    -- "Reuniones agendadas": meetings still 'scheduled' with their time in the FULL period, not capped at now (upcoming and "por confirmar"). A reschedule
    -- closes the old row as 'rescheduled', so it counts once, with the new date. Scoped by the BD who owns the meeting.
    rpt_meetings_scheduled as (
      select count(*)::int as pbc_count
      from ${meeting}
      where meeting.status = 'scheduled'
        and meeting.scheduled_at >= ${fromIso}::timestamptz
        and meeting.scheduled_at < ${scheduledToIso}::timestamptz
        and (${bdId}::uuid is null or meeting.bd_id = ${bdId}::uuid)
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
        'rateContacted', pbc_rate_contacted,
        'rateReplied', pbc_rate_replied,
        'meeting', pbc_meeting,
        'discarded', pbc_discarded
      ) from rpt_funnel) as funnel,
      coalesce((select json_agg(json_build_object('sourceKey', pbc_source_key, 'status', pbc_status, 'count', pbc_count)) from rpt_source_status), '[]'::json) as source_status,
      coalesce((select json_agg(json_build_object('reason', pbc_reason, 'count', pbc_count)) from rpt_discard_reasons), '[]'::json) as discard_reasons,
      coalesce((select json_agg(json_build_object('stage', pbc_stage, 'count', pbc_count)) from rpt_pipeline), '[]'::json) as pipeline,
      (select pbc_in_period from rpt_won_period) as won_in_period,
      (select pbc_undated from rpt_won_period) as won_undated,
      (select pbc_count from rpt_meetings_scheduled) as meetings_scheduled,
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
        -- A dial is dated by happenedAtSql() falling through to created_at: call_attempt is in neither OCCURRED_AT_ACTIVITY_TYPES
        -- nor NON_TOUCH_ACTIVITY_TYPES, and recordCallAttempt writes the row at click time, so created_at IS the dial time.
        -- No fold filter and no result filter on purpose (see ACTIVITY_BY_BD_TYPES).
        count(*) filter (where activity.type = 'call_attempt')::int as pbc_call_attempts,
        count(*) filter (where activity.type = 'call')::int as pbc_calls,
        count(*) filter (where activity.type = 'meeting_logged')::int as pbc_meetings,
        count(*) filter (where activity.type = 'email_sent')::int as pbc_emails_sent,
        count(*) filter (where activity.type = 'reply_received')::int as pbc_replies_received
      from ${activity}
      where activity.actor_bd_id is not null
        and activity.type in (${activityTypes})
        and (${bdId}::uuid is null or activity.actor_bd_id = ${bdId}::uuid)
        -- happenedAtSql (workDoneAtSql + a meeting's own metadata.at), NOT effectiveActivityAtSql, on purpose: this asks "how much did this BD do?", so a note the BD wrote
        -- and later deleted still counts (as queue_worked below already does). The follow-up queue asks a different question,
        -- "is this contact stale?", and deliberately keeps the display rule (a deleted note is often one filed on the WRONG
        -- contact, which is no evidence the contact is warm). Do not "fix" either back into agreement with the other.
        and ${happenedAtSql()} >= ${fromIso}::timestamptz
        and ${happenedAtSql()} < ${toIso}::timestamptz
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
            and ${sql.raw(WORKED_AT_SQL_TEXT)} >= (${sql.raw(QUEUE_DAY_START_UTC_SQL_TEXT)} + interval '3 hours')
            and ${sql.raw(WORKED_AT_SQL_TEXT)} < (${sql.raw(QUEUE_DAY_START_UTC_SQL_TEXT)} + interval '1 day 3 hours')
        ))::int as pbc_worked,
        count(*) filter (where follow_up_queue_item.state = 'pending' and not exists (
          select 1 from ${activity}
          where activity.person_id = follow_up_queue_item.person_id
            and activity.type in (${workedTypes})
            and ${sql.raw(WORKED_AT_SQL_TEXT)} >= (${sql.raw(QUEUE_DAY_START_UTC_SQL_TEXT)} + interval '3 hours')
            and ${sql.raw(WORKED_AT_SQL_TEXT)} < (${sql.raw(QUEUE_DAY_START_UTC_SQL_TEXT)} + interval '1 day 3 hours')
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
      coalesce(rpt_activity_pivot.pbc_call_attempts, 0) as call_attempts,
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
  funnel: { newTotal: number; contactedOrMore: number; repliedOrMore: number; rateContacted: number; rateReplied: number; meeting: number; discarded: number };
  sourceStatus: { sourceKey: string | null; status: string; count: number }[];
  discardReasons: { reason: string; count: number }[];
  pipeline: { stage: string | null; count: number }[];
  /** "Empresas ganadas" for the selected period: currently-won companies whose move to 'won' falls in it. */
  wonInPeriod: number;
  /** Currently-won companies with no real close date (no recorded move to 'won', or one before WON_TRACKING_STARTS_AT: the initial load): in no period. */
  wonUndated: number;
  /** "Reuniones agendadas": meetings with status 'scheduled' whose scheduled_at falls in the period. */
  meetingsScheduled: number;
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
  /** Every `call_attempt` (dial) in the period, including attempts later settled into a `call`. */
  callAttempts: number;
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
  fromIso: string;
  toIso: string;
  bdId: string | null;
}

/**
 * "Empresas ganadas" KPI drilldown: the exact companies `rpt_won_period` counted (same `wonAtSql`, same
 * `companyBelongsToBdSql`, same [from, to)), so the number and its list cannot disagree. Undated won companies are
 * not listed (see wonAtSql). `rpt_won_company_person_owner` scans only the already-selected companies (correlated
 * EXISTS, rule 7).
 *
 * `owner_bd_id`/`owner_bd_name` prefer the company's own owner, falling back to its MOST RECENTLY updated owned,
 * non-merged person (prod: Datapar S.A. has no company owner but one owned contact).
 */
export function buildWonCompaniesDrilldownQuery({ fromIso, toIso, bdId }: WonCompaniesDrilldownParams) {
  return sql`
    with rpt_won_dated as (
      select
        company.company_key as pbc_company_key,
        company.display_name as pbc_display_name,
        company.owner_bd_id as pbc_owner_bd_id,
        ${wonAtSql()} as pbc_won_at
      from ${company}
      where company.relationship_stage = 'won'
        and ${companyBelongsToBdSql(bdId)}
    ),
    rpt_won_companies as (
      select pbc_company_key, pbc_display_name, pbc_owner_bd_id, pbc_won_at
      from rpt_won_dated
      where pbc_won_at >= ${WON_TRACKING_STARTS_AT_ISO}::timestamptz
        and pbc_won_at >= ${fromIso}::timestamptz
        and pbc_won_at < ${toIso}::timestamptz
    ),
    rpt_won_company_person_owner as (
      select distinct on (person.company_key)
        person.company_key as pbc_company_key,
        person.owner_bd_id as pbc_owner_bd_id
      from ${person}
      where person.merged_into_id is null
        and person.owner_bd_id is not null
        and exists (select 1 from rpt_won_companies where rpt_won_companies.pbc_company_key = person.company_key)
      order by person.company_key, person.updated_at desc, person.id
    )
    select
      rpt_won_companies.pbc_company_key as company_key,
      rpt_won_companies.pbc_display_name as display_name,
      coalesce(rpt_won_companies.pbc_owner_bd_id, rpt_won_company_person_owner.pbc_owner_bd_id) as owner_bd_id,
      bd.name as owner_bd_name,
      rpt_won_companies.pbc_won_at as won_at,
      true as won_at_exact
    from rpt_won_companies
    left join rpt_won_company_person_owner on rpt_won_company_person_owner.pbc_company_key = rpt_won_companies.pbc_company_key
    left join ${bd} on bd.id = coalesce(rpt_won_companies.pbc_owner_bd_id, rpt_won_company_person_owner.pbc_owner_bd_id)
    order by won_at desc
    limit ${DRILLDOWN_ROW_LIMIT}
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

/**
 * "Reuniones realizadas" KPI drilldown (reports-bd-filter-drilldown).
 * Actor-scoped (`activity.actor_bd_id`) and period-scoped
 * by when the meeting HAPPENED (`happenedAtDisplaySql()`: metadata.at, created_at as fallback), matching this KPI's own definition exactly —
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
      ${happenedAtDisplaySql()} as meeting_at
    from ${activity}
    join ${person} on person.id = activity.person_id and person.merged_into_id is null
    left join ${company} on company.company_key = person.company_key
    left join ${bd} on bd.id = activity.actor_bd_id
    where activity.type = 'meeting_logged'
      and (${bdId}::uuid is null or activity.actor_bd_id = ${bdId}::uuid)
      and ${happenedAtDisplaySql()} >= ${fromIso}::timestamptz
      and ${happenedAtDisplaySql()} < ${toIso}::timestamptz
    order by meeting_at desc
    limit ${DRILLDOWN_ROW_LIMIT}
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

export interface CohortDrilldownParams extends ReportAggregatesParams {
  population: CohortPopulation;
  /** The reply-rate tile's list: leaves out current clients (won + active), exactly like its number. */
  excludeClients?: boolean;
}

/**
 * Cohort drill-down behind "Tasa de respuesta" and the funnel's Contactado /
 * Respondió / Reunión rows (reports-kpi-drilldown): the persons `rpt_funnel`
 * counted for `population`, by CURRENT status, in the same cohort scope.
 * MIN_RATE_SAMPLE never reaches this query — it is a display rule only.
 *
 * Reply populations add two best-effort columns, both LEFT-joined so a missing
 * value never drops a person: the latest `reply_received` activity's effective
 * time (`metadata.occurredAt`), and the Sequence of the member's latest
 * `replied_at` (not populated until outreach-sequences PR 10, so it is null in
 * production today). A contact moved to Respondió by hand has neither.
 * Ordered by most recent reply, no-reply last; Contactado by creation date.
 */
export function buildCohortDrilldownQuery(params: CohortDrilldownParams) {
  const statuses = sql.join(
    COHORT_STATUSES[params.population].map((s) => sql`${s}`),
    sql`, `,
  );
  // "new" (empty list) is the whole cohort: no status predicate at all.
  const statusFilter = COHORT_STATUSES[params.population].length > 0 ? sql`
        and person.status in (${statuses})` : sql``;
  const withReply = cohortHasReplyColumns(params.population);
  const replyCtes = withReply
    ? sql`,
    rpt_cohort_reply as (
      select distinct on (activity.person_id)
        activity.person_id as pbc_person_id,
        ${effectiveActivityAtSql()} as pbc_reply_at
      from ${activity}
      where activity.type = 'reply_received'
        and exists (select 1 from rpt_cohort where rpt_cohort.pbc_id = activity.person_id)
      order by activity.person_id, ${effectiveActivityAtSql()} desc nulls last
    ),
    rpt_cohort_sequence as (
      select distinct on (sequence_member.person_id)
        sequence_member.person_id as pbc_person_id,
        sequence.id as pbc_sequence_id,
        sequence.name as pbc_sequence_name
      from ${sequenceMember}
      join ${sequence} on sequence.id = sequence_member.sequence_id
      where sequence_member.replied_at is not null
        and exists (select 1 from rpt_cohort where rpt_cohort.pbc_id = sequence_member.person_id)
      order by sequence_member.person_id, sequence_member.replied_at desc, sequence_member.id
    )`
    : sql``;
  const replySelect = withReply
    ? sql`rpt_cohort_reply.pbc_reply_at as reply_at, rpt_cohort_sequence.pbc_sequence_id as sequence_id, rpt_cohort_sequence.pbc_sequence_name as sequence_name`
    : sql`null::timestamptz as reply_at, null::uuid as sequence_id, null::text as sequence_name`;
  const replyJoins = withReply
    ? sql`left join rpt_cohort_reply on rpt_cohort_reply.pbc_person_id = rpt_cohort.pbc_id
    left join rpt_cohort_sequence on rpt_cohort_sequence.pbc_person_id = rpt_cohort.pbc_id`
    : sql``;
  const order = withReply
    ? sql`rpt_cohort_reply.pbc_reply_at desc nulls last, rpt_cohort.pbc_created_at desc, rpt_cohort.pbc_id`
    : sql`rpt_cohort.pbc_created_at desc, rpt_cohort.pbc_id`;
  return sql`
    with rpt_cohort as (
      select
        person.id as pbc_id,
        person.first_name as pbc_first_name,
        person.last_name as pbc_last_name,
        person.company_key as pbc_company_key,
        person.owner_bd_id as pbc_owner_bd_id,
        person.status as pbc_status,
        person.role_group as pbc_role_group,
        person.job_title as pbc_job_title,
        person.created_at as pbc_created_at
      from ${person}
      where ${cohortScopeSql(params)}${statusFilter}${params.excludeClients ? sql`
        and ${notCurrentClientPersonSql()}` : sql``}
    )${replyCtes}
    select
      rpt_cohort.pbc_id as person_id,
      rpt_cohort.pbc_first_name as first_name,
      rpt_cohort.pbc_last_name as last_name,
      company.display_name as company_name,
      bd.name as owner_bd_name,
      rpt_cohort.pbc_status as status,
      rpt_cohort.pbc_role_group as role_group,
      rpt_cohort.pbc_job_title as job_title,
      rpt_cohort.pbc_created_at as created_at,
      ${replySelect}
    from rpt_cohort
    left join ${company} on company.company_key = rpt_cohort.pbc_company_key
    left join ${bd} on bd.id = rpt_cohort.pbc_owner_bd_id
    ${replyJoins}
    order by ${order}
    limit ${DRILLDOWN_ROW_LIMIT}
  `;
}

export type CohortDrilldownRawResultRow = {
  person_id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  owner_bd_name: string | null;
  status: string;
  role_group: string | null;
  job_title: string | null;
  created_at: Date | string;
  reply_at: Date | string | null;
  sequence_id: string | null;
  sequence_name: string | null;
};
