/**
 * Pure query builder for scripts/backfill-default-pipeline-stage.ts's
 * candidate read. Schema-only import (no `@/db` client), so this stays
 * importable — and this file's own test stays runnable — without a live
 * DATABASE_URL, same convention as
 * src/lib/contacts/effectiveActivityTime.ts.
 *
 * Bug fixed here (reviewer-caught, would have thrown against prod): every
 * table this query touches is interpolated into `FROM`/`JOIN` via its
 * Drizzle schema object (`${activity}`, `${person}`, `${personBdConnection}`,
 * `${company}`) and left UNALIASED, with every column reference elsewhere in
 * the same CTE written as literal `<table>.<column>` text matching that
 * real table name — e.g. `from ${activity} ... where activity.person_id ...`.
 * An earlier version wrote `from activity a` and referenced `a.person_id`;
 * that alias hid the "activity" FROM-clause entry from Postgres, while
 * `effectiveActivityAtSql()` (src/lib/contacts/effectiveActivityTime.ts)
 * always renders fully-qualified `"activity"."type"` /
 * `"activity"."metadata"` / `"activity"."created_at"` — pinned to the
 * table's real name, never a caller-chosen alias — so the qualified
 * reference failed with "invalid reference to FROM-clause entry for table
 * activity". This is the exact same discipline
 * src/lib/contacts/listQueries.ts's `getContactListPage` already documents
 * and follows for the identical reason (see that function's "two
 * correlated subqueries" comment). tests/unit/defaultPipelineStageQuery.test.ts
 * renders this query through drizzle's `PgDialect` (no DB) and asserts the
 * pattern holds for every table here, not just `activity`.
 *
 * "Effective last touch" reuses
 * src/lib/contacts/effectiveActivityTime.ts#effectiveActivityAtSql — the
 * SAME helper `listQueries.ts`'s `lastActivityDays` filter and the
 * decision brief's own Q1.1 use — never a second definition (rule 6). The
 * CTE shape (pre-aggregate `activity` and `person_bd_connection` by
 * person_id BEFORE joining to `person`) mirrors Q1.1 exactly, so sums are
 * never multiplied by a fan-out join (rule 5), and every CTE's OWN output
 * column is prefixed `dps_` so it can never collide with a joined table's
 * own column (rule 4) — CTEs are joined unaliased too, so `dps_activity`,
 * `dps_connection`, `dps_touch`, `dps_qualifying_company` are themselves
 * the qualifiers used afterward. The 12-month cutoff is computed with
 * Postgres's own `now()`, never a JS `Date` interpolated into the template
 * (rule 1) — `person`, `activity`, and `person_bd_connection`'s timestamp
 * columns are all naive `timestamp without time zone` in UTC, so doing
 * this arithmetic in JS would risk a timezone skew that
 * `now() - interval '12 months'` avoids by construction.
 */
import { sql } from "drizzle-orm";
import { activity, company, person, personBdConnection } from "@/db/schema";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";

export function buildDefaultPipelineStageCandidatesQuery() {
  return sql`
    with dps_activity as (
      select activity.person_id as dps_activity_person_id,
        max(${effectiveActivityAtSql()}) as dps_activity_at
      from ${activity}
      where activity.person_id is not null
      group by activity.person_id
    ),
    dps_connection as (
      select person_bd_connection.person_id as dps_connection_person_id,
        max(person_bd_connection.last_message_at) as dps_connection_at
      from ${personBdConnection}
      where person_bd_connection.last_message_at is not null
      group by person_bd_connection.person_id
    ),
    dps_touch as (
      select
        person.company_key as dps_company_key,
        greatest(
          coalesce(dps_activity.dps_activity_at, timestamptz '-infinity'),
          coalesce(dps_connection.dps_connection_at, timestamptz '-infinity')
        ) as dps_last_touch
      from ${person}
      left join dps_activity on dps_activity.dps_activity_person_id = person.id
      left join dps_connection on dps_connection.dps_connection_person_id = person.id
      where person.merged_into_id is null
        and person.company_key is not null
        and person.status in ('replied', 'meeting')
    ),
    dps_qualifying_company as (
      select distinct dps_touch.dps_company_key as dps_qc_company_key
      from dps_touch
      where dps_touch.dps_last_touch >= now() - interval '12 months'
    )
    select
      company.company_key as company_key,
      company.account_type as account_type,
      (dps_qualifying_company.dps_qc_company_key is not null) as has_recent_qualifying_contact
    from ${company}
    left join dps_qualifying_company on dps_qualifying_company.dps_qc_company_key = company.company_key
    where company.relationship_stage is null
  `;
}
