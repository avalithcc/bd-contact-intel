/**
 * Roster picker SQL, built as a pure drizzle `sql` fragment so tests render it with no database. It deliberately has NO
 * is_startup predicate or ranking: target_company.is_startup is a lazily populated, nullable inference, and filtering
 * on it cut a real candidate pool from 18 to 2 (measured 2026-10-14).
 */
import { sql } from "drizzle-orm";

export const ROSTER_PICKER_MAX_LIMIT = 200;

/**
 * The person's company client_status, or NULL. ANY non-null value ('active' or 'inactive') marks a client:
 * an 'inactive' client is a past client and gets no cold outreach.
 */
export const clientStatusSql = sql`(
  select c.client_status from company c
  where c.client_status is not null
    and (c.company_key = p.company_key
      or c.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))
  limit 1
)`;

export function buildRosterCandidatesQuery(opts: { limit: number; search?: string }) {
  const limit = Math.min(Math.max(Math.trunc(opts.limit) || 1, 1), ROSTER_PICKER_MAX_LIMIT);
  const term = opts.search?.trim();
  const search = term
    ? sql`and (concat_ws(' ', p.first_name, p.last_name, p.company) ilike ${`%${term}%`})`
    : sql``;
  return sql`
    select p.id as person_id, p.first_name, p.last_name, p.email, p.job_title,
           p.company, p.company_key, h.is_florida
    from person p
    join lateral (
      select count(*) as open_it, coalesce(bool_or(jp.is_miami), false) as is_florida
      from job_posting jp
      where jp.is_it = true and jp.closed_at is null and jp.market = 'us'
        and (jp.company_key = p.company_key
          or jp.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))
    ) h on h.open_it > 0
    where p.merged_into_id is null
      and btrim(coalesce(p.email, '')) <> ''
      and p.email_status <> 'none'
      and (p.email_source is distinct from 'pattern_inferred' or p.email_status = 'verified')
      and ${clientStatusSql} is null
      and not exists (
        select 1 from email_suppression s
        where (s.kind = 'address' and s.value = p.email_normalized)
           or (s.kind = 'domain' and s.value = split_part(p.email_normalized, '@', 2))
      )
      ${search}
    order by p.company, p.last_name, p.first_name, p.id
    limit ${limit}`;
}
