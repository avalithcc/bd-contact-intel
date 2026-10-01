/**
 * The ONE production round trip that decides a BD's daily follow-up queue
 * (rule: "the selection query is one round trip"; openspec/decisions/
 * 2026-09-30-decision-brief.md "1. Follow-up cadence — decided"). This is
 * the single canonical place the eligibility/ordering rule is written down
 * and enforced: owned by the BD, not merged, `status` is `replied` (due at
 * 3+ days since the last touch) or `contacted` (due at 7+ days), last
 * touched within 12 months, ordered replied-first then most-recent-touch-
 * first, tie-broken by company name ascending, capped at `FOLLOW_UP_DAILY_CAP`.
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
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
import { FOLLOW_UP_DAILY_CAP } from "@/lib/followUp/queueSelection";

/** `with` body only (no leading `with` keyword) so callers can splice in
 * their own additional CTEs/final SELECT around it. */
export function fuqCandidatesCte() {
  return sql`
    fuq_activity as (
      select activity.person_id as fuq_activity_person_id,
        max(${effectiveActivityAtSql()}) as fuq_activity_at
      from ${activity}
      where activity.person_id is not null
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
        ) as fuq_last_touch
      from ${person}
      left join fuq_activity on fuq_activity.fuq_activity_person_id = person.id
      left join fuq_connection on fuq_connection.fuq_connection_person_id = person.id
      left join ${company} on company.company_key = person.company_key
      where person.merged_into_id is null
        and person.owner_bd_id is not null
        and person.status in ('contacted', 'replied')
    ),
    fuq_due as (
      select *
      from fuq_candidate
      where fuq_last_touch >= now() - interval '12 months'
        and (
          (fuq_status = 'replied' and fuq_last_touch <= now() - interval '3 days')
          or (fuq_status = 'contacted' and fuq_last_touch <= now() - interval '7 days')
        )
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
    insert into ${followUpQueueItem} (bd_id, queue_date, person_id, position, due_status, last_touch_at)
    select ${bdId}::uuid, ${queueDate}::date, fuq_selected.fuq_person_id, fuq_selected.fuq_position,
      fuq_selected.fuq_status, fuq_selected.fuq_last_touch
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
      limit ${cap}
    ) as fuq_selected
    on conflict (bd_id, queue_date, person_id) do nothing
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
export function buildFollowUpVerificationQuery(cap: number = FOLLOW_UP_DAILY_CAP) {
  return sql`
    with ${fuqCandidatesCte()}
    select fuq_owner_bd_id as owner_bd_id, count(*)::int as eligible_count,
      least(count(*), ${cap})::int as queue_count
    from fuq_due
    group by fuq_owner_bd_id
    order by queue_count desc, eligible_count desc
  `;
}
