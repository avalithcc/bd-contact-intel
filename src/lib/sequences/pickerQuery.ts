/**
 * The SQL behind one page of the "Nueva secuencia" contact picker, built as a pure drizzle `sql` fragment so unit tests
 * render it with no database. DB-free on purpose (no `@/db`); the read that runs it is pageQueries.listPickerPage.
 *
 * The pool is EVERY live contact with an email (not merged, address present). Search, Florida, hiring and owner are
 * FILTERS; none restricts the pool unless the BD turns it on. ONE statement (PERFORMANCE.md), ordered and cut to
 * LIMIT + 1 (the extra row proves there is more).
 *
 * "Blocked" mirrors the SQL-decidable part of the static admission (rosterGuards.staticRosterRejection): unreachable
 * email, pattern-inferred and unverified, client company, suppressed address or domain, and a contact with no
 * compliance audience (no location signal at all; an embargoed jurisdiction is decided by the JS side, see below). It only ORDERS (blocked last) and FILTERS (hidden by default); the reason a row shows still comes from the
 * JS admission (pickerView.staticBlock), the same one addMembersToSequence re-runs, so a mismatch here can only mis-order.
 *
 * The recipient's audience is resolveComplianceAudience() (person country, company country, open posting markets, then the
 * phone's dial code). SQL cannot run that resolver, so the authority stays in JS and the SQL only consumes its answer: the
 * countries the resolver HOLDS (unrecognized text, and embargoed jurisdictions) come in as a list built by `countryFacts`,
 * and the dial codes that place a phone in any country come in as one prefix pattern (`phoneLocatedPattern`).
 *
 * THE DIRECTION OF ERROR IS THE DESIGN. This query FILTERS on the blocked flag, so a row it blocks is invisible with no
 * badge. Wrongly blocking hides a contactable person; wrongly allowing only shows a row that the JS admission then badges
 * `unmappedMarket` and the add guard refuses. So every approximation here may err toward showing, never toward hiding.
 * The sanctions list is NOT encoded in the SQL for the same reason as one source of truth: a Cuban PHONE (no country text)
 * is shown in the default view with its badge, and the add guard refuses it. Writing the embargo into the pattern too would
 * be a second copy that can drift from complianceAudience.ts.
 */
import { sql, type SQL } from "drizzle-orm";
import { FLORIDA_PHRASES, FLORIDA_TOKENS, classifyMarket } from "@/lib/hiring/markets";
import { openFreshPostingSql, openPostingSql } from "@/lib/hiring/openPosting";
import { termContainsSql } from "@/lib/search/accentInsensitive";
import { resolveComplianceAudience } from "./complianceAudience";
import { PICKER_PAGE_SIZE, searchTokens, type PickerQuery } from "./pickerFilters";
import { phoneCallingCodes } from "./phoneMarket";
import { canonicalCompanyJoinSql, companyNameColumnsSql, displayedCompanySql, firstFilledCountry, firstFilledText } from "./rosterQuery";

/**
 * Lower-cased, trimmed country strings. `unmapped` = the compliance audience holds them; `us` = classifyMarket says US.
 * The two are independent: `us` is the HIRING (Florida) filter and must not follow the audience.
 */
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
    if (!resolveComplianceAudience({ mobilePhone: null, phone: null, personCountry: country })) unmapped.add(country);
    if (classifyMarket(country) === "us") us.add(country);
  }
  return { unmapped: [...unmapped], us: [...us] };
}

/**
 * The fewest digits (calling code included) a phone must carry before the SQL link may match it. A floor against garbage,
 * not a validity check: production holds a few hundred phone values the normalization pass flagged invalid or not-valid
 * (`+5491`, `+54`...), and without a floor any of them on a no-country contact would match its country prefix and surface
 * in the default view. DERIVED, not guessed, by brute force: random national numbers fed to libphonenumber's `isValid()` for
 * every country the audience mailed at the time (the LATAM and US markets), keeping the shortest that validates. The shortest REAL subscriber numbers are Paraguay at 9 digits and
 * then 10 (Panama 507+7, Brazil, Colombia, Peru). 8 sits one below Paraguay's 9, so the floor cannot clip a real
 * SUBSCRIBER number; the unit test asserts it against every country's example number.
 *
 * KNOWN COST 2, derived when every located country became mailable: libphonenumber accepts numbers shorter than the floor
 * for 14 calling codes (ZA, TA, NL, LU, AT, NO, DE, UY, AU, NZ, NU, TK, KR, IR). A phone-only contact whose number is one of
 * them is hidden with no badge. Whether each is a real subscriber number or a special is NOT established (Uruguay is the
 * case accepted below). The set is derived by scripts/scan-short-phone-numbers.ts and pinned in the unit test
 * (`SHORT_VALID_WITNESSES`) so a change fails loudly. Same trade, same reasoning as below.
 *
 * KNOWN COST, measured and accepted: `isValid()` also accepts a few 7-digit Uruguayan non-subscriber specials
 * (`+5982000`, four national digits). Those fail the floor, so SQL calls the row blocked while JS would admit it — the
 * SEVERE direction, a row hidden from the default view with no badge to explain it. Accepted because no person answers
 * one of those numbers, and dropping the floor to 7 would re-admit the `+5491` garbage the floor exists to keep out. Do
 * not lower it without something that separates those two cases.
 *
 * The search gave the same answer under the `min` metadata that phoneMarket.ts imports and under `max`
 * (phoneNormalize.ts uses `max`), so the variant does not move the floor. The lookahead counts DIGITS only: a `+` in the
 * class would let `+54+++++` clear it. There is no upper bound: an extension only lengthens a number JS accepts.
 */
export const PHONE_MIN_LENGTH = 8;

/**
 * Postgres ARE for the fourth link of the audience: a phone whose dial code places it in some country. Built in JS
 * (phoneCallingCodes), because SQL has no libphonenumber. Anchored on the `+` of the stored E.164 value; calling codes are
 * prefix-free, so a prefix test never confuses two countries. Every located country has an address now, so unlike the
 * old per-market lists there is nothing to order: the question is only "does a plausible number place this contact at all".
 *
 * An empty code list (nothing to match) yields `(?!)`, which matches nothing: a bare `^\+()` would admit every number that
 * starts with a plus.
 *
 * RESIDUAL, on purpose, and in the TOLERABLE direction: SQL cannot say `isValid()` and does not know the embargo. A
 * malformed number that clears the length floor, and a phone from an embargoed jurisdiction (Cuba +53, Iran +98, North Korea
 * +850, Syria +963), CAN appear in the default view, badged `unmappedMarket` by the JS admission; the add guard
 * (`staticRosterRejection`) refuses them. That is the decision recorded in the header: a usable row is never hidden and an
 * unusable one is never added. The reverse (SQL hiding a row JS would allow) is guarded by the length floor and
 * `phoneDigits` and pinned by the all-countries example test, with the measured exceptions named on PHONE_MIN_LENGTH.
 */
export function buildPhoneLocatedPattern(codes: readonly string[]): string {
  if (!codes.length) return "(?!)";
  return `^\\+(?=[0-9]{${PHONE_MIN_LENGTH},})(${codes.join("|")})`;
}

let locatedPatternCache: string | null = null;
/**
 * Computed once per server instance: ~240 region lookups to produce a constant. The cache is not observable through
 * behaviour (the value is identical either way), so it has no test; it is a plain `??=`.
 */
export function phoneLocatedPattern(): string {
  return (locatedPatternCache ??= buildPhoneLocatedPattern(phoneCallingCodes()));
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
const companyCountry = firstFilledCountry(sql`cn.country`, sql`cca.country`);
/** The company's industry by the same two paths as its country: the person's own company row, then the alias target's. NULL = none. */
const companyIndustry = firstFilledText(sql`cn.industry`, sql`cca.industry`);
const clientStatus = sql`coalesce(cn.client_status, cca.client_status)`;
/** The first country link of the audience that has data; NULL means the postings decide. */
export const effectiveCountry = sql`coalesce(nullif(btrim(p.country), ''), ${companyCountry})`;

/** Same rule as the roster query: the address, or its exact domain, is on the company-wide opt-out list. */
const suppressedSql = sql`(lower(btrim(p.email)) in (select s.value from email_suppression s where s.kind = 'address')
  or split_part(lower(btrim(p.email)), '@', 2) in (select s.value from email_suppression s where s.kind = 'domain'))`;

/** The person's own city / region names Florida while their country is the US or unknown. */
const homeInFlorida = (f: CountryFacts) =>
  sql`((${effectiveCountry} is null or lower(${effectiveCountry}) = any(${textArray(f.us)})) and concat_ws(' ', p.city, p.region) ~* ${floridaGeoPattern()})`;

/**
 * A phone reduced to `+` and ASCII digits. libphonenumber-js reads three digit scripts as digits (fullwidth, Arabic-Indic,
 * Extended Arabic-Indic; checked, Devanagari and Thai it does not), so a stored `+１ 305 555 1234` is a valid number for the
 * JS resolver. They are folded to ASCII with `translate` first, then everything else is stripped; without the fold the
 * strip would drop those digits, the prefix anchor would fail and the picker would hide a row JS allows. The fullwidth `＋`
 * is NOT folded because libphonenumber-js does not accept it as a plus either. One `translate` per phone column per row.
 */
export const DIGIT_SCRIPTS = [0xff10, 0x0660, 0x06f0].map((zero) => Array.from({ length: 10 }, (_, d) => String.fromCodePoint(zero + d)).join("")).join("");
export const ASCII_DIGITS_FOR_SCRIPTS = "0123456789".repeat(3);
const phoneDigits = (col: string) =>
  sql.raw(`regexp_replace(translate(coalesce(${col}, ''), '${DIGIT_SCRIPTS}', '${ASCII_DIGITS_FOR_SCRIPTS}'), '[^0-9+]', '', 'g')`);
/** The same normalization as `phoneDigits`, in JS, built from the same constants: the model of the SQL the unit tests use. */
export const normalizePhoneLikeSql = (value: string): string =>
  [...value].map((ch) => { const i = DIGIT_SCRIPTS.indexOf(ch); return i < 0 ? ch : ASCII_DIGITS_FOR_SCRIPTS[i]; }).join("").replace(/[^0-9+]/g, "");

/**
 * The fourth link: either phone starts with a dial code that places it in a country. Non-digits are stripped first (libphonenumber
 * tolerates spaces, dashes and brackets, a `+54 (9) 11` would otherwise miss the anchor). Two regex tests on columns of the
 * row itself: no subquery, no join, nothing per row beyond the row. Either phone, not "mobile first": a superset of the
 * JS pick, which is the safe direction (see buildPhoneLocatedPattern).
 */
const phoneIsLocated = () => {
  const pattern = phoneLocatedPattern();
  return sql`(${phoneDigits("p.mobile_phone")} ~ ${pattern} or ${phoneDigits("p.phone")} ~ ${pattern})`;
};

function blockedSql(f: CountryFacts): SQL {
  // A country decides its market alone; only without one do the postings (exactly one of us / latam is a market), and only
  // when those do not either does the phone's dial code (the audience's last link).
  const unmapped = sql`case when ${effectiveCountry} is not null then lower(${effectiveCountry}) = any(${textArray(f.unmapped)}) else (${either("posts_us")} = ${either("posts_latam")} and not ${phoneIsLocated()}) end`;
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

/** The industry predicate: the listed raw values, and/or "no industry". Neither selected adds nothing. */
function industryPredicates(q: PickerQuery): SQL[] {
  const any = [
    ...(q.industries.length ? [sql`${companyIndustry} = any(${textArray(q.industries)})`] : []),
    ...(q.noIndustry ? [sql`${companyIndustry} is null`] : []),
  ];
  return any.length ? [sql`(${sql.join(any, sql` or `)})`] : [];
}

/** The country predicate: the listed values, and/or "no country", on the EFFECTIVE country. Neither selected adds nothing. */
function countryPredicates(q: PickerQuery): SQL[] {
  const any = [
    ...(q.countries.length ? [sql`${effectiveCountry} = any(${textArray(q.countries)})`] : []),
    ...(q.noCountry ? [sql`${effectiveCountry} is null`] : []),
  ];
  return any.length ? [sql`(${sql.join(any, sql` or `)})`] : [];
}

/**
 * THE POOL: `from person p ... where <every predicate>`, the one text both the page and the chip counts are built
 * from. Eligibility, the toggles, the search and the industry filter are all spelled in here and nowhere else, so a
 * predicate changed or added here reaches the list and the chip counts together; neither statement has a WHERE of its own
 * (a unit test fails if one grows one). Both must be preceded by `with ${jobFacts}` because the joins read `pk_jf`.
 */
export function buildPickerPoolSql(q: PickerQuery, meId: string, facts: CountryFacts): SQL {
  const predicates = [
    sql`p.merged_into_id is null`,
    sql`btrim(coalesce(p.email, '')) <> ''`,
    ...(q.mine ? [sql`p.owner_bd_id = ${meId}::uuid`] : []),
    ...(q.hiring ? [sql`${hireCount} > 0`] : []),
    // Florida / Miami: the company has an open fresh US IT posting flagged job_posting.is_miami (the old definition), or
    // the person's own city / region names Florida.
    ...(q.florida ? [sql`(${postingFlorida} or ${homeInFlorida(facts)})`] : []),
    ...industryPredicates(q),
    ...countryPredicates(q),
    ...(q.showBlocked ? [] : [sql`not ${blockedSql(facts)}`]),
  ];
  return sql`
    from person p
    ${canonicalCompanyJoinSql}
    ${joins}
    where ${sql.join(predicates, sql` and `)} ${searchSql(q.search)}`;
}

export function buildPickerPageQuery(q: PickerQuery, meId: string, facts: CountryFacts): SQL {
  // Hidden blocked rows need no sort key; a constant would be read as an ORDER BY position.
  const blockedFirst = q.showBlocked ? sql`${blockedSql(facts)}, ` : sql``;
  return sql`
    with ${jobFacts}
    select p.id::text as person_id, p.first_name, p.last_name, p.email, p.email_status, p.email_source, p.job_title, p.status,
           ${companyNameColumnsSql}, p.company_key, p.merged_into_id::text as merged_into_id, ${clientStatus} as client_status,
           ${hireCount}::int as open_it, (${postingFlorida} or ${homeInFlorida(facts)}) as is_florida,
           ${suppressedSql} as suppressed, p.country as person_country, p.mobile_phone, p.phone, ${companyCountry} as company_country,
           array_remove(array[case when ${either("posts_us")} then 'us' end, case when ${either("posts_latam")} then 'latam' end], null) as posting_markets
    ${buildPickerPoolSql(q, meId, facts)}
    order by ${blockedFirst}${displayedCompanySql}, p.last_name, p.first_name, p.id
    offset ${q.offset} limit ${PICKER_PAGE_SIZE + 1}`;
}

/** Industry values (91 mapped + unknown + null) plus countries (~60): a belt against a pathological column, not a working limit. */
export const PICKER_COUNTS_MAX_ROWS = 1000;

const allOf = (preds: SQL[]): SQL => (preds.length ? preds[0] : sql`true`);

/**
 * Contacts per raw company industry AND per effective country over the SAME pool as the list (buildPickerPoolSql), in ONE
 * pass: `grouping sets` computes both marginals together. The `()` set adds the two checkbox counts (Florida, hiring): how many contacts carry the signal under BOTH selections, which is what ticking the box would leave. Each marginal is its dimension's chip count, so it must have ITS
 * OWN selection lifted and the OTHER one applied: the pool is read with both selections lifted, and each selection comes back as
 * a boolean flag (`ci_ind_ok`, `ci_pais_ok`, built from the very predicates the pool uses). The industry rows count the
 * contacts that pass the country flag, the country rows those that pass the industry flag. Every other filter (search,
 * Florida, hiring, mine, showBlocked) narrows both, inside the pool. Zero-count rows are dropped (absent = 0). Only valid for
 * the `q` the page was read with: buildPickerReads is the one place that pairs them.
 */
export function buildPickerCountsQuery(q: PickerQuery, meId: string, facts: CountryFacts): SQL {
  const pool = buildPickerPoolSql({ ...q, industries: [], noIndustry: false, countries: [], noCountry: false }, meId, facts);
  return sql`
    with ${jobFacts},
    pk_cnt as (
      select ${companyIndustry} as ci_ind, ${effectiveCountry} as ci_pais, ${allOf(industryPredicates(q))} as ci_ind_ok, ${allOf(countryPredicates(q))} as ci_pais_ok,
             (${postingFlorida} or ${homeInFlorida(facts)}) as ci_florida, ${hireCount} > 0 as ci_hire
      ${pool}
    ),
    pk_grp as (
      select ci_ind, ci_pais, grouping(ci_ind, ci_pais) as ci_g,
             count(*) filter (where ci_pais_ok) as ci_n_ind, count(*) filter (where ci_ind_ok) as ci_n_pais,
             count(*) filter (where ci_florida and ci_ind_ok and ci_pais_ok) as ci_n_florida, count(*) filter (where ci_hire and ci_ind_ok and ci_pais_ok) as ci_n_hire
      from pk_cnt
      group by grouping sets ((ci_ind), (ci_pais), ())
    )
    select dim, val, n from (
      select case when ci_g = 1 then 'industry' else 'country' end as dim, case when ci_g = 1 then ci_ind else ci_pais end as val,
             case when ci_g = 1 then ci_n_ind else ci_n_pais end as n
      from pk_grp where ci_g in (1, 2)
      union all select 'signal', 'florida', ci_n_florida from pk_grp where ci_g = 3
      union all select 'signal', 'hiring', ci_n_hire from pk_grp where ci_g = 3
    ) ci_rows
    where n > 0
    order by n desc
    limit ${PICKER_COUNTS_MAX_ROWS}`;
}

/**
 * THE call-level pairing: the statements one picker request runs, both built from the SAME `q`. The chip counts are
 * recomputed whenever the query restarts the list (offset 0, which is exactly when `pickerQueryKey` changed or the first
 * page loads) and skipped when only the page advances ("Cargar más"), because the pool the counts describe cannot change
 * with the offset. `counts: null` means "unchanged, keep the ones you have".
 */
export function buildPickerReads(q: PickerQuery, meId: string, facts: CountryFacts): { page: SQL; counts: SQL | null } {
  return { page: buildPickerPageQuery(q, meId, facts), counts: q.offset === 0 ? buildPickerCountsQuery(q, meId, facts) : null };
}
