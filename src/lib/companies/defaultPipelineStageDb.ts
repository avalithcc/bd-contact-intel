/**
 * Thin DB glue for scripts/backfill-default-pipeline-stage.ts. Imports `db`
 * (side-effecting, requires DATABASE_URL), so this file is not unit-tested
 * directly — classifyDefaultPipelineStage/planDefaultPipelineStages
 * (defaultPipelineStage.ts) carry the tested classification logic; this
 * module only computes the one signal that logic can't derive on its own:
 * `hasRecentQualifyingContact`.
 *
 * "Effective last touch" reuses
 * src/lib/contacts/effectiveActivityTime.ts#effectiveActivityAtSql — the
 * SAME helper `listQueries.ts`'s `lastActivityDays` filter and the
 * decision brief's own Q1.1 use — never a second definition (rule 6). The
 * CTE shape (pre-aggregate `activity` and `person_bd_connection` by
 * person_id BEFORE joining to `person`) mirrors Q1.1 exactly, so sums are
 * never multiplied by a fan-out join (rule 5), and every CTE column is
 * prefixed `dps_` so it can never collide with a joined table's own column
 * (rule 4). The 12-month cutoff is computed with Postgres's own `now()`,
 * never a JS `Date` interpolated into the template (rule 1) — `person`,
 * `activity`, and `person_bd_connection`'s timestamp columns are all naive
 * `timestamp without time zone` in UTC, so doing this arithmetic in JS
 * would risk a timezone skew that `now() - interval '12 months'` avoids by
 * construction.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";

export interface CompanyDefaultStageCandidateRow {
  companyKey: string;
  accountType: string | null;
  hasRecentQualifyingContact: boolean;
}

/** Every `company` row whose `relationship_stage` is currently NULL — the
 * write path re-checks this same condition at write time (rule: re-check
 * before writing), so a row that a BD sets between this read and the write
 * is never overwritten. */
export async function readCompanyDefaultStageCandidates(): Promise<CompanyDefaultStageCandidateRow[]> {
  const rows = (await db.execute(sql`
    with dps_activity as (
      select a.person_id as dps_person_id,
        max(${effectiveActivityAtSql()}) as dps_activity_at
      from activity a
      where a.person_id is not null
      group by a.person_id
    ),
    dps_connection as (
      select pbc.person_id as dps_conn_person_id,
        max(pbc.last_message_at) as dps_connection_at
      from person_bd_connection pbc
      where pbc.last_message_at is not null
      group by pbc.person_id
    ),
    dps_touch as (
      select
        p.company_key as dps_company_key,
        greatest(
          coalesce(da.dps_activity_at, timestamptz '-infinity'),
          coalesce(dc.dps_connection_at, timestamptz '-infinity')
        ) as dps_last_touch
      from person p
      left join dps_activity da on da.dps_person_id = p.id
      left join dps_connection dc on dc.dps_conn_person_id = p.id
      where p.merged_into_id is null
        and p.company_key is not null
        and p.status in ('replied', 'meeting')
    ),
    dps_qualifying_company as (
      select distinct dps_touch.dps_company_key as dps_qc_company_key
      from dps_touch
      where dps_touch.dps_last_touch >= now() - interval '12 months'
    )
    select
      c.company_key as company_key,
      c.account_type as account_type,
      (qc.dps_qc_company_key is not null) as has_recent_qualifying_contact
    from company c
    left join dps_qualifying_company qc on qc.dps_qc_company_key = c.company_key
    where c.relationship_stage is null
  `)) as unknown as {
    company_key: string;
    account_type: string | null;
    has_recent_qualifying_contact: boolean;
  }[];

  return rows.map((row) => ({
    companyKey: row.company_key,
    accountType: row.account_type,
    hasRecentQualifyingContact: row.has_recent_qualifying_contact,
  }));
}
