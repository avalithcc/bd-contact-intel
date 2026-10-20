/**
 * The SQL behind one page of the "Nueva secuencia" contact picker, built as a pure drizzle `sql` fragment so unit tests
 * render it with no database. DB-free on purpose (no `@/db`); the read that runs it is pageQueries.listPickerPage.
 *
 * The pool is EVERY live contact with an email (not merged, address present). Search, Florida, hiring and owner are
 * FILTERS; none restricts the pool unless the BD turns it on. ONE statement (PERFORMANCE.md), ordered and cut to
 * LIMIT + 1 (the extra row proves there is more).
 *
 * "Blocked" mirrors the SQL-decidable part of the static admission (rosterGuards.staticRosterRejection): unreachable
 * email, pattern-inferred and unverified, client company, suppressed address or domain, and a market with no postal
 * address. It only ORDERS (blocked last) and FILTERS (hidden by default); the reason a row shows still comes from the
 * JS admission (pickerView.staticBlock), the same one addMembersToSequence re-runs, so a mismatch here can only mis-order.
 *
 * The recipient market is recipientMarket() (person country, company country, then open posting markets). SQL cannot
 * run classifyMarket, so the countries it classes as unmapped / US come in as a list built by `countryFacts`.
 */
import { sql, type SQL } from "drizzle-orm";
import { FLORIDA_PHRASES, FLORIDA_TOKENS, classifyMarket } from "@/lib/hiring/markets";
import { openFreshPostingSql, openPostingSql } from "@/lib/hiring/openPosting";
import { termContainsSql } from "@/lib/search/accentInsensitive";
import { isMarketMapped } from "./draftCompose";
import { PICKER_PAGE_SIZE, searchTokens, type PickerQuery } from "./pickerFilters";
import { recipientMarket } from "./recipientMarket";
import { canonicalCompanyJoinSql, companyNameColumnsSql, displayedCompanySql } from "./rosterQuery";

/** Lower-cased, trimmed country strings by what the compliance footer can do with them. */
export type CountryFacts = { unmapped: string[]; us: string[] };

/** Every distinct country text on a person or a company: tiny (a few hundred values) against 26k rows. */
export const distinctCountriesSql = sql`
  select distinct lower(btrim(v)) as country
  from (select country as v from person union all select country from company) t
  where btrim(coalesce(v, '')) <> ''`;

export function countryFacts(countries: readonly string[]): CountryFacts {
  const unmapped = new Set<string>();
  const us = new Set<string>();
  for (const raw of countries) {
    const country = raw.trim().toLowerCase();
    if (!country) continue;
    if (!isMarketMapped(recipientMarket({ personCountry: country }))) unmapped.add(country);
    else if (classifyMarket(country) === "us") us.add(country);
  }
  return { unmapped: [...unmapped], us: [...us] };
}

/** Postgres ARE: substring phrases plus the bare `fl` as a whole word (never inside "Flores"). */
export function floridaGeoPattern(): string {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(${[...FLORIDA_PHRASES.map(escape), ...FLORIDA_TOKENS.map((t) => `\\m${escape(t)}\\M`)].join("|")})`;
}

const textArray = (values: readonly string[]): SQL =>
  values.length ? sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]` : sql`array[]::text[]`;

/**
 * SET-BASED on purpose. The by-id reads (rosterQuery.ts) look a company up with `company_key = x or company_key in (alias
 * subquery)`, which makes Postgres Seq Scan `company` / `job_posting` once PER PERSON: fine for a handful of ids, 18 s
 * over 26k people (measured). Here the company facts are joined once instead:
 *
 *   pk_jf   one row per company with an open IT posting (hiring count, Florida, which markets it posts in)
 *   cn      the person's own company row;  cca / a   the canonical company its key is an alias of (if any)
 *
 * and a fact is "the company's, or its canonical company's", the same union the `or ... in` form expressed.
 */
const joins = sql`
  left join company_alias ca on ca.alias_key = p.company_key
  left join company cca on cca.company_key = ca.company_key and cca.company_key <> p.company_key
  left join pk_jf d on d.company_key = p.company_key
  left join pk_jf a on a.company_key = ca.company_key and a.company_key <> p.company_key`;

const jobFacts = sql`pk_jf as (
  select jp.company_key,
         count(*) filter (where ${openFreshPostingSql("jp")} and jp.market = 'us') as hire,
         coalesce(bool_or(jp.is_miami) filter (where ${openFreshPostingSql("jp")} and jp.market = 'us'), false) as florida,
         bool_or(jp.market = 'us') as posts_us, bool_or(jp.market = 'latam') as posts_latam
  from job_posting jp
  where jp.is_it = true and ${openPostingSql("jp")}
  group by jp.company_key
)`;

const either = (col: string) => sql.raw(`(coalesce(d.${col}, false) or coalesce(a.${col}, false))`);
const hireCount = sql`(coalesce(d.hire, 0) + coalesce(a.hire, 0))`;
const postingFlorida = either("florida");
const companyCountry = sql`coalesce(nullif(btrim(cn.country), ''), nullif(btrim(cca.country), ''))`;
const clientStatus = sql`coalesce(cn.client_status, cca.client_status)`;
/** The first country link of recipientMarket that has data; NULL means the postings decide. */
const effectiveCountry = sql`coalesce(nullif(btrim(p.country), ''), ${companyCountry})`;

/** Same rule as the roster query: the address, or its exact domain, is on the company-wide opt-out list. */
const suppressedSql = sql`(lower(btrim(p.email)) in (select s.value from email_suppression s where s.kind = 'address')
  or split_part(lower(btrim(p.email)), '@', 2) in (select s.value from email_suppression s where s.kind = 'domain'))`;

/** The person's own city / region names Florida while their country is the US or unknown. */
const homeInFlorida = (f: CountryFacts) =>
  sql`((${effectiveCountry} is null or lower(${effectiveCountry}) = any(${textArray(f.us)})) and concat_ws(' ', p.city, p.region) ~* ${floridaGeoPattern()})`;

function blockedSql(f: CountryFacts): SQL {
  // A country decides its market alone; only without one do the postings: exactly one of us / latam is a market.
  const unmapped = sql`case when ${effectiveCountry} is not null then lower(${effectiveCountry}) = any(${textArray(f.unmapped)}) else ${either("posts_us")} = ${either("posts_latam")} end`;
  return sql`coalesce((
    p.email_status in ('none', 'bounced')
    or (p.email_source = 'pattern_inferred' and p.email_status <> 'verified')
    or ${clientStatus} is not null
    or ${suppressedSql}
    or ${unmapped}), false)`;
}

/**
 * Every token must appear in the contact's name, DISPLAYED company (free text, else the canonical name: the Contacts list
 * rule), email or job title, ignoring case and accents. One folded haystack per row instead of one `unaccent` per column:
 * `unaccent` is the expensive part (5 calls per row and token measured 280 ms over 26k people). The fields are joined with
 * a space and a token never contains one, so a token cannot match across two fields.
 */
function searchSql(search: string): SQL {
  const haystack = sql`concat_ws(' ', p.first_name, p.last_name, coalesce(nullif(p.company, ''), cn.display_name), p.email, p.job_title)`;
  const tokens = searchTokens(search).map((t) => termContainsSql(haystack, t));
  return tokens.length ? sql`and ${sql.join(tokens, sql` and `)}` : sql``;
}

export function buildPickerPageQuery(q: PickerQuery, meId: string, facts: CountryFacts): SQL {
  const blocked = blockedSql(facts);
  const predicates = [
    sql`p.merged_into_id is null`,
    sql`btrim(coalesce(p.email, '')) <> ''`,
    ...(q.mine ? [sql`p.owner_bd_id = ${meId}::uuid`] : []),
    ...(q.hiring ? [sql`${hireCount} > 0`] : []),
    // Florida / Miami: the company has an open fresh US IT posting flagged job_posting.is_miami (the old definition), or
    // the person's own city / region names Florida.
    ...(q.florida ? [sql`(${postingFlorida} or ${homeInFlorida(facts)})`] : []),
    ...(q.showBlocked ? [] : [sql`not ${blocked}`]),
  ];
  // Hidden blocked rows need no sort key; a constant would be read as an ORDER BY position.
  const blockedFirst = q.showBlocked ? sql`${blocked}, ` : sql``;
  return sql`
    with ${jobFacts}
    select p.id::text as person_id, p.first_name, p.last_name, p.email, p.email_status, p.email_source, p.job_title, p.status,
           ${companyNameColumnsSql}, p.company_key, p.merged_into_id::text as merged_into_id, ${clientStatus} as client_status,
           ${hireCount}::int as open_it, (${postingFlorida} or ${homeInFlorida(facts)}) as is_florida,
           ${suppressedSql} as suppressed, p.country as person_country, ${companyCountry} as company_country,
           array_remove(array[case when ${either("posts_us")} then 'us' end, case when ${either("posts_latam")} then 'latam' end], null) as posting_markets
    from person p
    ${canonicalCompanyJoinSql}
    ${joins}
    where ${sql.join(predicates, sql` and `)} ${searchSql(q.search)}
    order by ${blockedFirst}${displayedCompanySql}, p.last_name, p.first_name, p.id
    offset ${q.offset} limit ${PICKER_PAGE_SIZE + 1}`;
}
