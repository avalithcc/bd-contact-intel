/**
 * Roster picker SQL, built as a pure drizzle `sql` fragment so tests render it with no database. It deliberately has NO
 * is_startup predicate or ranking: target_company.is_startup is a lazily populated, nullable inference, and filtering
 * on it cut a real candidate pool from 18 to 2 (measured 2026-10-14).
 */
import { sql, type SQL } from "drizzle-orm";
import { companyNameMatchCondition } from "@/lib/contacts/companyNameCondition";
import { openFreshPostingSql, openPostingSql } from "@/lib/hiring/openPosting";
import { termContainsSql } from "@/lib/search/accentInsensitive";

export const ROSTER_PICKER_MAX_LIMIT = 200;

type CompanyAliasTarget = "jp" | "c";

/**
 * THE "this row belongs to the company of `person p`" predicate: the row's `company_key` is the person's own, or the
 * canonical key of a company alias the person's key is registered under. `alias` names the table alias of the row being
 * tested, `jp` for `job_posting` or `c` for `company`; the query must also select `from person p`.
 *
 * Every reader of the compliance audience, the picker, drafting, release and the roster goes through this one text, so
 * they cannot disagree about whose postings or client status count (they did, #372-#374). Do not spell it inline: a
 * unit test fails on any other copy under src/.
 *
 * It uses `sql.raw`, which normally warrants suspicion, so the alias text is looked up from a fixed record and never
 * interpolated from the argument. The emitted SQL therefore cannot come from the caller at all, not even through an
 * `as any` cast; the union type is only the compile-time layer on top. Do not "simplify" the lookup back to a template
 * interpolation: that would make the guarantee compile-time only.
 */
const ALIAS_SQL_TEXT: Record<CompanyAliasTarget, string> = { jp: "jp", c: "c" };
export const sameCompanyAs = (alias: CompanyAliasTarget): SQL => {
  const a = ALIAS_SQL_TEXT[alias];
  return sql.raw(`(${a}.company_key = p.company_key or ${a}.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))`);
};

/**
 * The person's company client_status, or NULL. ANY non-null value ('active' or 'inactive') marks a client:
 * an 'inactive' client is a past client and gets no cold outreach.
 */
export const clientStatusSql = sql`(
  select c.client_status from company c
  where c.client_status is not null
    and ${sameCompanyAs("c")}
  limit 1
)`;

/**
 * THE company country rule of the audience's second link, shared by the picker (set-based joins) and the add guard
 * (by-id read) so they cannot disagree: the person's OWN company row first, then the canonical company its key is an alias
 * of, a blank value counting as missing. NULL means the postings decide.
 */
export const firstFilledCountry = (own: SQL, canonical: SQL): SQL => sql`coalesce(nullif(btrim(${own}), ''), nullif(btrim(${canonical}), ''))`;

/** `firstFilledCountry` for a `from person p` read with no company joins. */
export const companyCountrySql = firstFilledCountry(
  sql`(select c.country from company c where c.company_key = p.company_key)`,
  sql`(select c.country from company c join company_alias ca on ca.company_key = c.company_key where ca.alias_key = p.company_key and c.company_key <> p.company_key limit 1)`,
);

/** The open IT posting markets of the person's company (the third link of the compliance audience), as a JSON array. */
export const postingMarketsSql = sql`coalesce((select json_agg(distinct jp.market) from job_posting jp where jp.is_it = true and ${openPostingSql("jp")} and ${sameCompanyAs("jp")}), '[]'::json)`;

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
export const companyMatchSql = (term: string) => companyNameMatchCondition(term, { company: sql`p.company`, companyKey: sql`p.company_key` });

export function buildRosterCandidatesQuery(opts: { limit: number; search?: string }) {
  const limit = Math.min(Math.max(Math.trunc(opts.limit) || 1, 1), ROSTER_PICKER_MAX_LIMIT);
  const term = opts.search?.trim();
  const search = term
    ? sql`and (${termContainsSql(sql`concat_ws(' ', p.first_name, p.last_name)`, term)} or ${companyMatchSql(term)})`
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
        and ${sameCompanyAs("jp")}
    ) h on h.open_it > 0
    where p.merged_into_id is null
      and btrim(coalesce(p.email, '')) <> ''
      and p.email_status not in ('none', 'bounced')
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
