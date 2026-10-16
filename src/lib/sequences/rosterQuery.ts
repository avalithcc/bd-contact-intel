/**
 * Roster picker SQL, built as a pure drizzle `sql` fragment so tests render it with no database. It deliberately has NO
 * is_startup predicate or ranking: target_company.is_startup is a lazily populated, nullable inference, and filtering
 * on it cut a real candidate pool from 18 to 2 (measured 2026-10-14).
 */
import { sql } from "drizzle-orm";
import { companyNameMatchCondition } from "@/lib/contacts/companyNameCondition";
import { openFreshPostingSql } from "@/lib/hiring/openPosting";

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

/**
 * The company NAME a Sequence read shows, same rule and same join as the Contacts list (companyDisplayName.ts): free
 * text wins, `company.display_name` fills a null. Joins `company` on `person.company_key` DIRECTLY and not through
 * `company_alias`, deliberately: /contacts shows the same name for the same person, and the search below
 * (companyNameMatchCondition) matches exactly what is displayed. `company_key` is the primary key, so the join cannot
 * fan out; a key with no `company` row yields NULL. Alias resolution stays where it is logic (postings, client status,
 * country), never display.
 */
export const canonicalCompanyJoinSql = sql`left join company cn on cn.company_key = p.company_key`;
/** The select-list pair `withResolvedCompanyName` resolves. */
export const companyNameColumnsSql = sql`p.company, cn.display_name as "companyCanonicalName"`;
/** The name the user SEES as a sort key (`resolveCompanyDisplayName` in SQL). */
export const displayedCompanySql = sql`coalesce(p.company, cn.display_name)`;
/** The Contacts list's company match, spelled for a `from person p` read. */
export const companyMatchSql = (pattern: string) => companyNameMatchCondition(pattern, { company: sql`p.company`, companyKey: sql`p.company_key` });

export function buildRosterCandidatesQuery(opts: { limit: number; search?: string }) {
  const limit = Math.min(Math.max(Math.trunc(opts.limit) || 1, 1), ROSTER_PICKER_MAX_LIMIT);
  const term = opts.search?.trim();
  const search = term
    ? sql`and (concat_ws(' ', p.first_name, p.last_name) ilike ${`%${term}%`} or ${companyMatchSql(`%${term}%`)})`
    : sql``;
  return sql`
    select p.id as person_id, p.first_name, p.last_name, p.email, p.job_title,
           ${companyNameColumnsSql}, p.company_key, h.is_florida
    from person p
    ${canonicalCompanyJoinSql}
    join lateral (
      select count(*) as open_it, coalesce(bool_or(jp.is_miami), false) as is_florida
      from job_posting jp
      where jp.is_it = true and ${openFreshPostingSql("jp")} and jp.market = 'us'
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
    order by ${displayedCompanySql}, p.last_name, p.first_name, p.id
    limit ${limit}`;
}
