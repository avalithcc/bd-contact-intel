/**
 * The ONE production round trip that decides a BD's daily follow-up queue
 * (rule: "the selection query is one round trip"; openspec/decisions/
 * 2026-09-30-decision-brief.md "1. Follow-up cadence — decided"). This is
 * the single canonical place the eligibility/ordering rule is written down
 * and enforced: owned by the BD, not merged, `status` is `replied` or
 * `contacted` and 5+ days have passed since the last touch (follow-up-expiry,
 * owner decision 2026-10-27; it used to be 3 / 7), last touched within 12
 * months, ordered replied-first then most-recent-touch-first, tie-broken by
 * company name ascending, capped at `FOLLOW_UP_DAILY_CAP` new entries a day.
 * A contact already in an open cycle (carried, see openCycle.ts) or dropped
 * since its last touch is not a new entry; the cap is reduced by the carried
 * items still in days 1-2, and Vencidos never use it.
 * A contact whose most recent touch is a `call` activity with outcome
 * `wrong_number` is NOT eligible (launch-readiness finding F6), however old
 * that call is; any newer touch brings the contact back on its own (see
 * `WRONG_NUMBER_OUTCOME` below).
 * Schema-only import (no `@/db` client), so this stays importable — and
 * this file's own test stays runnable — without a live DATABASE_URL, same
 * convention as src/lib/companies/defaultPipelineStageQuery.ts.
 *
 * Every table is interpolated via its Drizzle schema object and left
 * UNALIASED in FROM/JOIN, with every column reference elsewhere written as
 * literal `<table>.<column>` text matching that real table name —
 * `effectiveActivityAtSql()` always renders fully-qualified
 * `"activity"."type"`/`"activity"."metadata"`/`"activity"."created_at"`,
 * pinned to the table's real name, never a caller-chosen alias (see that
 * defaultPipelineStageQuery.ts doc comment for the exact prod bug this
 * discipline prevents). tests/unit/followUpCandidateQuery.test.ts renders
 * this through drizzle's `PgDialect` and asserts the pattern holds.
 *
 * `fuqCandidatesCte()` pre-aggregates `activity`/`person_bd_connection`
 * BEFORE joining `person` (rule 5: pre-aggregate before fan-out joins), and
 * every CTE's own output column is prefixed `fuq_` (rule 4) so it can never
 * collide with a joined table's own column. The 3-day/7-day/12-month
 * thresholds are computed with Postgres's own `now()` and `interval`, never
 * a JS `Date` interpolated into the template (rule 1) — `activity`/`person`
 * and `person_bd_connection` timestamps are all `timestamptz` (slices 3, 5
 * and 6), so the `greatest(coalesce(...))` below has no session-TimeZone
 * cast, and `follow_up_queue_item.last_touch_at` (slice 6) receives a
 * `timestamptz` as-is. Doing this arithmetic in JS would still risk a
 * timezone skew that `now() - interval '...'` avoids by construction.
 *
 * Shared by two callers: `buildFollowUpInsertQuery` (one BD, capped at 10,
 * used by the lazy once-a-day materialization) and
 * `buildFollowUpVerificationQuery` (every BD, uncapped + grouped — the
 * orchestrator's read-only "how many would enter today's queue, per BD"
 * check).
 */
import { sql } from "drizzle-orm";
import { activity, company, followUpQueueItem, person, personBdConnection } from "@/db/schema";
import type { CallOutcomeCode } from "@/lib/contacts/call";
import { NO_PROGRESS_ACTIVITY_TYPES } from "@/lib/activity/noProgressActivity";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
import { notActiveClientCompanySql } from "@/lib/followUp/activeClientExclusion";
import { FOLLOW_UP_ACTIVITY_TYPES, FOLLOW_UP_DROP_ACTIVITY_TYPES, FOLLOW_UP_REENTERED_TYPE } from "@/lib/followUp/activityTypes";
import { FOLLOW_UP_ENTRY_DAYS } from "@/lib/followUp/cycle";
import { EXPIRY_LOOKBACK_DAYS, carriedNormalCountSql, openCycleRowSql } from "@/lib/followUp/openCycle";
import { FOLLOW_UP_DAILY_CAP } from "@/lib/followUp/queueSelection";

/**
 * The call outcome code that takes a contact out of the queue. Typed against
 * `CallOutcomeCode` (src/lib/contacts/call.ts) so a rename there fails the
 * typecheck here instead of silently never matching. It is inlined with
 * `sql.raw` because it is a compile-time constant, not user input.
 *
 * Status answers "what did the BD do?"; the queue answers "what is worth
 * doing today?". A wrong-number call still counts as `contacted` (owner rule
 * 2026-09-26, `callStage` in src/lib/status/deriveStatus.ts, unchanged): the
 * BD did the work. But handing the same dead number back a week later as
 * "call this today" is not worth doing, so the queue skips it. F6 was those
 * two questions being conflated.
 */
const WRONG_NUMBER_OUTCOME: CallOutcomeCode = "wrong_number";

/** `with` body only (no leading `with` keyword) so callers can splice in
 * their own additional CTEs/final SELECT around it. */
export interface CandidateOptions {
  /**
   * Skip the "open cycle" exclusion, which reads `follow_up_queue_item.cycle_started_on`. Only the read-only pre-migration
   * measurement (scripts/measure/follow-up-expiry-day0.ts) sets it false: before the column exists there are no cycles, so
   * the exclusion would exclude nobody. Every production caller leaves it on.
   */
  includeCycles?: boolean;
}

export function fuqCandidatesCte({ includeCycles = true }: CandidateOptions = {}) {
  return sql`
    fuq_activity as (
      select activity.person_id as fuq_activity_person_id,
        max(${effectiveActivityAtSql()}) as fuq_activity_at,
        max(case when activity.type = 'call'
            and activity.metadata ->> 'outcome' = ${sql.raw(`'${WRONG_NUMBER_OUTCOME}'`)}
          then ${effectiveActivityAtSql()} end) as fuq_wrong_number_at
      from ${activity}
      -- An unanswered dial is not a touch (NO_PROGRESS_ACTIVITY_TYPES): it must
      -- not reset the staleness window. Only that list; every other type,
      -- reply_received and status_change included, still moves the clock.
      where activity.person_id is not null
        and activity.type not in (${sql.join(
          NO_PROGRESS_ACTIVITY_TYPES.map((t) => sql`${t}`),
          sql`, `,
        )})
      group by activity.person_id
    ),
    fuq_connection as (
      select person_bd_connection.person_id as fuq_connection_person_id,
        max(person_bd_connection.last_message_at) as fuq_connection_at
      from ${personBdConnection}
      where person_bd_connection.last_message_at is not null
      group by person_bd_connection.person_id
    ),
    fuq_candidate as (
      select
        person.id as fuq_person_id,
        person.owner_bd_id as fuq_owner_bd_id,
        person.status as fuq_status,
        company.display_name as fuq_company_name,
        greatest(
          coalesce(fuq_activity.fuq_activity_at, timestamptz '-infinity'),
          coalesce(fuq_connection.fuq_connection_at, timestamptz '-infinity')
        ) as fuq_last_touch,
        fuq_activity.fuq_wrong_number_at as fuq_wrong_number_at
      from ${person}
      left join fuq_activity on fuq_activity.fuq_activity_person_id = person.id
      left join fuq_connection on fuq_connection.fuq_connection_person_id = person.id
      left join ${company} on company.company_key = person.company_key
      where person.merged_into_id is null
        and person.owner_bd_id is not null
        and person.status in ('contacted', 'replied')
        -- Owner decision 2026-10-26: no active clients in Seguimientos (inactive
        -- ones stay). Shared with the readers: activeClientExclusion.ts.
        and ${notActiveClientCompanySql(sql`person.company_key`)}
    ),
    fuq_due as (
      select *
      from fuq_candidate
      where fuq_last_touch >= now() - interval '12 months'
        -- fuq_wrong_number_at <= fuq_activity_at <= fuq_last_touch always
        -- holds, so ">=" is true exactly when the wrong-number call IS the
        -- latest touch. Any newer touch of any kind (email, reply, another
        -- call) raises fuq_last_touch and the contact re-enters the queue by
        -- itself: no stored flag, no manual un-flagging, no migration. Edge
        -- case: a wrong-number call sharing the exact same effective
        -- timestamp with another activity excludes the contact; rare and
        -- harmless, chosen over the complexity of breaking that tie.
        and not (fuq_wrong_number_at is not null and fuq_wrong_number_at >= fuq_last_touch)
        -- follow-up-expiry: both statuses enter five days after the last touch (was replied 3 / contacted 7).
        and fuq_last_touch <= now() - ${sql.raw(`interval '${FOLLOW_UP_ENTRY_DAYS} days'`)}
        -- A dropped contact (by a BD or by the expiry job) stays out until a NEW touch moves fuq_last_touch past the drop.
        and not exists (
          select 1 from ${activity}
          where activity.person_id = fuq_person_id
            and activity.type in (${sql.join(
              FOLLOW_UP_DROP_ACTIVITY_TYPES.map((t) => sql`${t}`),
              sql`, `,
            )})
            and activity.created_at > fuq_last_touch
        )
        -- A contact whose cycle is still open (the SAME predicate the page reads with, openCycle.ts) is carried, never re-added
        -- as new, whatever moved fuq_last_touch meanwhile (a Hunter lookup does). Rows older than the expiry job's lookback
        -- no longer block, so a job that stopped cannot strand a contact out of the queue for good.
        ${
          includeCycles
            ? sql`and not exists (
          select 1 from ${followUpQueueItem} fuq_cycle
          where fuq_cycle.bd_id = fuq_owner_bd_id
            and fuq_cycle.person_id = fuq_person_id
            and fuq_cycle.cycle_started_on is not null
            and fuq_cycle.queue_date > current_date - ${EXPIRY_LOOKBACK_DAYS}::int
            and ${openCycleRowSql({ rowRef: "fuq_cycle" })}
        )`
            : sql``
        }
    )
  `;
}

/** Shared `ORDER BY`: replied first, then most-recent-last-touch first,
 * tie-broken by company name ascending — the one place this ordering rule
 * is written down; see this file's own top-of-file doc comment for the full
 * eligibility rule (thresholds + recency window) enforced above in
 * `fuqCandidatesCte()`. */
function fuqOrderBy() {
  return sql`(fuq_status = 'replied') desc, fuq_last_touch desc, fuq_company_name asc nulls last`;
}

/**
 * One BD's top-`cap` due contacts, ready to insert into
 * `follow_up_queue_item` — `ON CONFLICT (bd_id, queue_date, person_id) DO
 * NOTHING` is the idempotent-insert half of the race guard (the primary
 * guard is `ensureTodayFollowUpQueue`'s `pg_advisory_xact_lock`; see that
 * function's doc comment). `bdId` is a plain uuid string, `queueDate` a
 * plain `YYYY-MM-DD` string (rule 1: never a JS `Date` in a raw `sql`
 * template) — both explicitly cast on the SQL side.
 *
 * Fresh-review fix: this used to never reference `follow_up_queue_item` at
 * all, so "Posponer a mañana"/"Omitir hoy" (`state`/`snoozed_until`,
 * queueQueries.ts#setFollowUpItemState) had no effect on selection — the
 * actual bug: a person snoozed further out than "tomorrow" would never be
 * excluded on the days in between. The `NOT EXISTS` below excludes anyone
 * with a prior `follow_up_queue_item` row for this SAME `bdId` whose
 * `snoozed_until` is still in the future relative to the queue_date being
 * computed; once `queueDate` reaches `snoozed_until`, the exclusion lifts
 * and the person is eligible again (still subject to every other rule).
 * Defense-in-depth for the SAME-queue_date case too: `ensureTodayFollowUpQueue`'s
 * `pg_advisory_xact_lock` already keeps materialization from ever re-running
 * for a day that's already been computed, so a postponed/skipped contact
 * reappearing that same day shouldn't happen regardless — this `NOT EXISTS`
 * just means the SQL itself doesn't silently depend on that alone.
 */
export function buildFollowUpInsertQuery(bdId: string, queueDate: string, cap: number = FOLLOW_UP_DAILY_CAP) {
  return sql`
    insert into ${followUpQueueItem} (bd_id, queue_date, person_id, position, due_status, last_touch_at, cycle_started_on)
    select ${bdId}::uuid, ${queueDate}::date, fuq_selected.fuq_person_id, fuq_selected.fuq_position,
      fuq_selected.fuq_status, fuq_selected.fuq_last_touch, ${queueDate}::date
    from (
      with ${fuqCandidatesCte()}
      select fuq_person_id, fuq_status, fuq_last_touch,
        row_number() over (order by ${fuqOrderBy()}) as fuq_position
      from fuq_due
      where fuq_owner_bd_id = ${bdId}::uuid
        and not exists (
          select 1 from ${followUpQueueItem} fuq_prior
          where fuq_prior.bd_id = ${bdId}::uuid
            and fuq_prior.person_id = fuq_due.fuq_person_id
            and fuq_prior.state in ('postponed', 'skipped')
            and fuq_prior.snoozed_until > ${queueDate}::date
        )
      order by ${fuqOrderBy()}
      -- Days 1-2 carried items fill the cap; Vencidos (3+) never do.
      limit greatest(${cap} - ${carriedNormalCountSql(bdId, queueDate)}, 0)
    ) as fuq_selected
    on conflict (bd_id, queue_date, person_id) do nothing
  `;
}

/**
 * follow-up-expiry: a contact that comes back after a drop gets ONE "Volvió a Seguimientos" system row, written right after the
 * day's rows are. Idempotent by construction: it fires only while the latest follow-up activity of the person is a drop, and
 * writing it makes the latest one a re-entry. Not a touch (activityTypes.ts), so it never restarts the cadence.
 */
export function buildFollowUpReentryQuery(bdId: string, queueDate: string) {
  return sql`
    insert into ${activity} (person_id, type, metadata)
    select follow_up_queue_item.person_id, ${FOLLOW_UP_REENTERED_TYPE}::text,
      jsonb_build_object('cycleStartedOn', follow_up_queue_item.cycle_started_on::text)
    from ${followUpQueueItem}
    where follow_up_queue_item.bd_id = ${bdId}::uuid
      and follow_up_queue_item.queue_date = ${queueDate}::date
      and follow_up_queue_item.cycle_started_on = ${queueDate}::date
      and (
        select last_event.type from ${activity} last_event
        where last_event.person_id = follow_up_queue_item.person_id
          and last_event.type in (${sql.join(
            FOLLOW_UP_ACTIVITY_TYPES.map((t) => sql`${t}`),
            sql`, `,
          )})
        order by last_event.created_at desc
        limit 1
      ) in (${sql.join(
        FOLLOW_UP_DROP_ACTIVITY_TYPES.map((t) => sql`${t}`),
        sql`, `,
      )})
  `;
}

/**
 * Read-only, all-BDs verification query (no writes, safe inside `BEGIN READ
 * ONLY`): per BD, how many contacts are eligible today and how many would
 * actually enter the queue once capped at `cap`. Handed to the orchestrator
 * to smoke-test the brief's "Cristian and Macarena hit the cap, Mariel has
 * only a handful" expectation against prod.
 *
 * Does NOT apply `buildFollowUpInsertQuery`'s snoozed-until exclusion — this
 * query has no single `bdId`/`queueDate` to scope that check to (it spans
 * every BD at once, for a snapshot estimate). `eligible_count`/`queue_count`
 * can therefore run slightly high on a day when someone has active
 * postponed/skipped rows; the real materialization is always the source of
 * truth.
 */
export function buildFollowUpVerificationQuery(cap: number = FOLLOW_UP_DAILY_CAP, options: CandidateOptions = {}) {
  return sql`
    with ${fuqCandidatesCte(options)}
    select fuq_owner_bd_id as owner_bd_id, count(*)::int as eligible_count,
      least(count(*), ${cap})::int as queue_count
    from fuq_due
    group by fuq_owner_bd_id
    order by queue_count desc, eligible_count desc
  `;
}
