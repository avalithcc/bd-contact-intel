import { sql, type SQL } from "drizzle-orm";
import { company, companyAlias, person } from "@/db/schema";
import { companyContactsCondition } from "@/lib/companies/contactCounts";
import { PICKER_MAX, normalizePickerQuery, probeKeys } from "@/lib/companies/companyPicker";
import { companySearchCondition } from "@/lib/companies/searchCondition";
import { escapeLikeWildcards, foldedIlikeRawPattern } from "@/lib/search/accentInsensitive";

/**
 * The company autocomplete's whole read: ONE statement, at most PICKER_MAX rows (PERFORMANCE.md: a round trip is
 * the budget and this fires while the BD types). Schema-only imports so the rendered SQL is unit-testable.
 *
 * Shape follows searchAbsorptionCandidates: the page is a CTE with its own LIMIT, so the contact count runs once per
 * RETURNED row, not once per match.
 *
 * It does NOT copy that read's count. That one is `count(*) ... where company_key = pg_key`, the raw key, which is
 * not alias-aware like the search predicate beside it. Here the count is what tells the BD which of two similar
 * companies is the real one, so under-counting a company whose contacts sit on an alias key would push them to
 * create yet another duplicate. companyContactsCondition is the record page's own predicate. No person sits on an
 * alias key today, so this changes no number now; it is correctness for the day someone merges two companies.
 *
 * Typed text: matched by companySearchCondition (name, domain, ALIAS, LinkedIn; same as /companies) plus exact-key
 * probes (probeKeys) so "Andina Tech" still returns "Andina" for the near-match warning, plus companies reached by
 * an alias key equal to a probe. Page order: probed/alias hits, then name-prefix hits, then the rest; the final
 * order puts the most populated first inside each group.
 *
 * Empty text: the companies with the most contacts. The ranking groups by the raw person key (a full pass over
 * ~17k people, ~ms); only the displayed count is alias-aware.
 */
export function buildCompanyPickerQuery(rawQuery: string): SQL {
  const q = normalizePickerQuery(rawQuery);
  const counted = sql`(select count(*) from ${person} where ${companyContactsCondition(sql`pg_key`)}) as contacts`;

  if (!q) {
    return sql`
      with pg_page as (
        select ${company.companyKey} as pg_key, ${company.displayName} as pg_name, ${company.domain} as pg_domain, 0 as pg_rank
        from ${company}
        join (
          select ${person.companyKey} as top_key, count(*) as top_n
          from ${person}
          where ${person.mergedIntoId} is null and ${person.companyKey} is not null
          group by ${person.companyKey}
          order by top_n desc, ${person.companyKey}
          limit ${PICKER_MAX}) top on top.top_key = ${company.companyKey}
        order by top.top_n desc, ${company.companyKey}
        limit ${PICKER_MAX})
      select pg_key as company_key, pg_name as display_name, pg_domain as domain, ${counted}
      from pg_page
      order by contacts desc, pg_name`;
  }

  const keys = probeKeys(q);
  const keyList = sql.join(keys.map((k) => sql`${k}`), sql`, `);
  const probed = keys.length
    ? sql`(${company.companyKey} in (${keyList})
      or ${company.companyKey} in (select ${companyAlias.companyKey} from ${companyAlias} where ${companyAlias.aliasKey} in (${keyList})))`
    : sql`false`;
  const text = companySearchCondition(q) ?? sql`false`;
  const prefix = foldedIlikeRawPattern(company.displayName, `${escapeLikeWildcards(q)}%`);
  return sql`
    with pg_page as (
      select ${company.companyKey} as pg_key, ${company.displayName} as pg_name, ${company.domain} as pg_domain,
        case when ${probed} then 0 when ${prefix} then 1 else 2 end as pg_rank
      from ${company}
      where ${text} or ${probed}
      order by pg_rank, ${company.displayName}, ${company.companyKey}
      limit ${PICKER_MAX})
    select pg_key as company_key, pg_name as display_name, pg_domain as domain, ${counted}
    from pg_page
    order by pg_rank, contacts desc, pg_name`;
}
