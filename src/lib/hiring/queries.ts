import { cache } from "react";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { companyAlias, contact, jobPosting, targetCompany } from "@/db/schema";
import { isOffshoreHeavy, type MarketKey } from "@/lib/hiring/markets";
import { LEADERSHIP_ROLE_GROUPS } from "@/lib/hiring/leadership";
import {
  countedBeforeDeltaWindowSql,
  openFreshPostingCondition,
  openFreshPostingSql,
} from "@/lib/hiring/openPosting";
import { compareByVacancies, hiringDelta, type HiringDelta } from "@/lib/hiring/delta";
import { parseDbTimestamp } from "@/lib/db/timestamp";
import {
  resolveCanonicalCompanyKey,
  toOpenPosting,
  type OpenPosting,
} from "@/lib/hiring/postingRow";

export { LEADERSHIP_ROLE_GROUPS, resolveCanonicalCompanyKey, toOpenPosting };
export type { OpenPosting };

export interface CompanyHiringSummary {
  companyKey: string;
  displayName: string;
  openItCount: number;
  // The signed-in BD's own crossover with this company (see getCompanyHiringSummaries below).
  contactCount: number;
  // Offshore-heavy verdict (strictly more open offshore-hub postings than LATAM ones, see isOffshoreHeavy). A
  // deprioritizing signal, not a disqualifying one.
  offshoreHeavy: boolean;
  // Startup classification (null = not classified yet), for the Startup badge.
  isStartup: boolean | null;
  // Counted postings per market bucket, for the secondary line under the company ("31 LATAM · 7 US · 2 Miami");
  // Miami is a subset of US. Derived from the postings already fetched.
  latamItCount: number;
  usItCount: number;
  miamiItCount: number;
  // Change in the counted total over the last 7 days (see hiringDelta).
  delta: HiringDelta;
}

type DetailRow = Omit<Parameters<typeof toOpenPosting>[0], "market">;

interface ResolvedHiringCompany {
  companyKey: string;
  displayName: string;
  postings: OpenPosting[];
  // Every contact.company_key value that should count as "works there":
  // the target company's own key plus any company_alias rows pointing at
  // it.
  matchKeys: Set<string>;
  // Open IT postings in an offshore delivery hub vs. in LATAM, and the
  // offshore-heavy verdict derived from them (see isOffshoreHeavy in
  // src/lib/hiring/markets.ts). All three are derived, not stored:
  // recomputed from the open postings already in this map every time
  // they're fetched, so they stay truthful as postings open and close
  // rather than going stale like a cached column on target_company would.
  offshoreItCount: number;
  latamItCount: number;
  usItCount: number;
  miamiItCount: number;
  // Counted postings. `postings` is only filled when the caller asks for the detail rows (withPostings).
  openItCount: number;
  offshoreHeavy: boolean;
  // Startup classification carried straight through from `target_company`
  // (see src/lib/hiring/startupClassification.ts) — null means "not
  // classified yet", distinct from a confirmed `false`. Same rationale as
  // offshoreItCount/latamItCount above: derived from data already joined in
  // query (1) below, never a separate lookup.
  isStartup: boolean | null;
  startupReason: string | null;
}

/**
 * Shared alias-resolution step for hiring signals: which target companies
 * currently have at least one open IT posting, those postings, and every
 * `company_alias` key that should count as "the same company" for matching
 * a contact's `company_key` against it (see matchKeys above) — a contact's
 * LinkedIn company name doesn't always normalize to the same key as the
 * target company (e.g. a legal entity vs. the brand name), and aliases
 * bridge that gap without per-row fuzzy matching.
 *
 * Two fixed queries regardless of caller — (1) open IT postings joined with
 * their target company's display name, (2) the aliases for those
 * companies — factored out here so getCompanyHiringSummaries (/hiring),
 * getHiringMatchIndex (/outreach) and getWhatsNewFeed (/whats-new) all
 * reuse it instead of each running their own alias lookup.
 *
 * `market` narrows query (1) to postings in that market bucket via a SQL
 * WHERE condition — not a post-fetch JS filter — so passing it never
 * changes the query count and never fetches rows outside the selected
 * market. Omitted/undefined means "all markets" (today's behavior).
 *
 * `miamiOnly` further narrows query (1) to `is_miami = true` (see
 * src/lib/hiring/markets.ts#isMiamiArea), same SQL-WHERE approach — no
 * query count change. It's a sub-filter of "us", but this function doesn't
 * enforce that pairing itself (callers only ever pass it alongside
 * `market: "us"` — see the page components under src/app/*).
 *
 * `hideOffshore`, when true, excludes companies whose open IT hiring is
 * offshore-heavy (see src/lib/hiring/markets.ts#isOffshoreHeavy: strictly
 * more open postings in an offshore delivery hub than in LATAM) entirely
 * from the result — via two correlated scalar-count subqueries in query
 * (1)'s SQL WHERE clause comparing the two counts directly in Postgres, not
 * a post-fetch JS filter, so it never changes the query count (still one
 * round trip). This is an opt-in hide, off by default: an offshore-heavy
 * company is a weaker but not worthless prospect (see the `offshoreHeavy`
 * field below), so the default behavior is to show and deprioritize them,
 * never to drop them silently. A company with offshore postings but an
 * equal-or-larger LATAM footprint is never hidden — it isn't offshore-heavy
 * at all, see isOffshoreHeavy.
 *
 * `withPostings` (default true) controls whether the per-posting detail rows are selected and returned in
 * `postings`; the counts (`openItCount`, markets, offshore) are always filled. whats-new and outreach read the
 * detail, so only the Vacantes table opts out.
 *
 * `startupsOnly`, when true, further narrows query (1) to
 * `target_company.is_startup = true` (see
 * src/lib/hiring/startupClassification.ts) — same SQL-WHERE approach as the
 * filters above, no query count change. A company that hasn't been
 * classified yet (`is_startup IS NULL`) is excluded, same as one confirmed
 * `false`: this is an opt-in "show me startups" filter, not a "hide
 * confirmed non-startups" one, so an unclassified company is "not (yet) a
 * match" rather than shown.
 */
export async function resolveHiringCompanies(
  market?: MarketKey,
  miamiOnly?: boolean,
  hideOffshore?: boolean,
  startupsOnly?: boolean,
  withPostings = true,
): Promise<Map<string, ResolvedHiringCompany>> {
  // Per-posting detail (title, URL, location, dates) is only fetched when the caller renders it. The Vacantes table
  // shows counts only, so it passes `withPostings = false` and the row set shrinks to the columns it aggregates.
  const detailColumns = {
    id: jobPosting.id,
    title: jobPosting.title,
    location: jobPosting.location,
    url: jobPosting.url,
    postedAt: jobPosting.postedAt,
    firstSeen: jobPosting.firstSeen,
  };
  const openPostings = await db
    .select({
      companyKey: jobPosting.companyKey,
      displayName: targetCompany.displayName,
      market: jobPosting.market,
      isOffshoreHub: jobPosting.isOffshoreHub,
      isStartup: targetCompany.isStartup,
      startupReason: targetCompany.startupReason,
      isMiami: jobPosting.isMiami,
      ...(withPostings ? detailColumns : ({} as Partial<typeof detailColumns>)),
    })
    .from(jobPosting)
    .innerJoin(targetCompany, eq(jobPosting.companyKey, targetCompany.companyKey))
    .where(
      and(
        eq(jobPosting.isIt, true),
        openFreshPostingCondition(),
        market ? eq(jobPosting.market, market) : undefined,
        miamiOnly ? eq(jobPosting.isMiami, true) : undefined,
        startupsOnly ? eq(targetCompany.isStartup, true) : undefined,
        // Offshore-heavy = strictly more open offshore postings than open
        // LATAM postings for the same company (see isOffshoreHeavy). Two
        // correlated scalar-count subqueries compared directly, rather than
        // a single NOT EXISTS, because this is now a comparison between two
        // aggregates, not a presence check — still one SQL statement, same
        // query count as before.
        hideOffshore
          ? sql`(
              select count(*) filter (where jp2.is_offshore_hub = true)
              from job_posting jp2
              where jp2.company_key = ${jobPosting.companyKey}
                and jp2.is_it = true
                and ${openFreshPostingSql("jp2")}
            ) <= (
              select count(*) filter (where jp2.market = 'latam')
              from job_posting jp2
              where jp2.company_key = ${jobPosting.companyKey}
                and jp2.is_it = true
                and ${openFreshPostingSql("jp2")}
            )`
          : undefined,
      ),
    )
    // `postedAt desc` alone is not a deterministic order: same-date postings
    // (common — a company posts a batch on the same day) came back in
    // whatever order Postgres felt like, which could reshuffle between
    // renders for no reason visible to the user. `id asc` breaks every tie
    // (see the equivalent ordering in getCompanyPostingsForKey below, kept
    // in sync so the whole-map and single-company paths return the exact
    // same order for a given company).
    .orderBy(...(withPostings ? [desc(jobPosting.postedAt), asc(jobPosting.id)] : []));

  const byCompany = new Map<string, ResolvedHiringCompany>();
  if (!openPostings.length) return byCompany;

  for (const p of openPostings) {
    const entry = byCompany.get(p.companyKey) ?? {
      companyKey: p.companyKey,
      displayName: p.displayName,
      postings: [],
      matchKeys: new Set([p.companyKey]),
      offshoreItCount: 0,
      latamItCount: 0,
      usItCount: 0,
      miamiItCount: 0,
      openItCount: 0,
      offshoreHeavy: false,
      isStartup: p.isStartup,
      startupReason: p.startupReason,
    };
    const market = (p.market as MarketKey | null) ?? "other";
    if (withPostings) entry.postings.push(toOpenPosting({ ...(p as DetailRow), market }));
    entry.openItCount++;
    if (p.isOffshoreHub) entry.offshoreItCount++;
    if (market === "latam") entry.latamItCount++;
    if (market === "us") entry.usItCount++;
    if (p.isMiami) entry.miamiItCount++;
    byCompany.set(p.companyKey, entry);
  }

  // A company's postings can arrive interleaved with other companies'
  // (query (1) is ordered by postedAt, not grouped), so offshoreItCount and
  // latamItCount above are only final once the loop above has finished —
  // offshoreHeavy is derived in a second, single pass over the now-final
  // per-company counts, still no extra query.
  for (const entry of byCompany.values()) {
    entry.offshoreHeavy = isOffshoreHeavy(entry.offshoreItCount, entry.latamItCount);
  }

  const companyKeys = [...byCompany.keys()];
  const aliases = await db
    .select({ aliasKey: companyAlias.aliasKey, companyKey: companyAlias.companyKey })
    .from(companyAlias)
    .where(inArray(companyAlias.companyKey, companyKeys));
  for (const a of aliases) byCompany.get(a.companyKey)?.matchKeys.add(a.aliasKey);

  return byCompany;
}

export interface HiringOverview {
  summaries: CompanyHiringSummary[];
  lastSyncAt: Date | null;
}

/**
 * The counted total of every company as it stood `POSTING_DELTA_WINDOW_DAYS` ago (same freshness rule evaluated at
 * that instant, see countedBeforeDeltaWindowSql) plus the last successful sync time, in ONE statement/round trip.
 * It replaces what would otherwise be separate opened/closed reads: the delta is today's total minus this baseline.
 * A flat cost (one grouped scan of IT postings, never per company). Timestamps and counts are normalized here
 * (raw SQL returns wire strings), never interpolated as JS Dates.
 */
async function getPreviousCountsAndSync(
  market?: MarketKey,
  miamiOnly?: boolean,
): Promise<{ previousByCompany: Map<string, number>; lastSyncAt: Date | null }> {
  const rows = await db.execute<{ lastSyncAt: Date | string | null; previous: Array<{ k: string; n: number }> }>(sql`
    select
      (select max(finished_at) from sync_run where status = 'ok') as "lastSyncAt",
      coalesce((
        select json_agg(json_build_object('k', c.company_key, 'n', c.n))
        from (
          select jp.company_key, count(*)::int as n
          from job_posting jp
          where jp.is_it = true
            and ${countedBeforeDeltaWindowSql("jp")}
            ${market ? sql`and jp.market = ${market}` : sql``}
            ${miamiOnly ? sql`and jp.is_miami = true` : sql``}
          group by jp.company_key
        ) c
      ), '[]'::json) as previous
  `);
  const row = rows[0];
  return {
    previousByCompany: new Map((row?.previous ?? []).map((r) => [r.k, Number(r.n)])),
    lastSyncAt: row?.lastSyncAt ? parseDbTimestamp(row.lastSyncAt) : null,
  };
}

/**
 * Target companies that currently have at least one open IT posting, with the counts the Vacantes table renders
 * (vacancies, per-market, offshore, startup), how many Contacts (company-wide, not per-BD) work there, and the
 * 7-day delta (today's counted total minus the total counted 7 days ago, see hiringDelta).
 *
 * `contactCount` is the signed-in BD's own contacts at the company (alias-aware, same `contact` rows and key set as
 * the `/?companyKey=` list the count links to via listContacts/companyKeyFilter), so the number and the page it
 * opens always agree.
 *
 * Four fixed queries regardless of how many companies/postings/contacts exist: the two behind
 * resolveHiringCompanies() (called without the per-posting detail columns, which this table never renders), the
 * baseline/sync read (getPreviousCountsAndSync), plus one GROUP BY over the BD's `contact` rows for every key (canonical + alias)
 * that resolves to any hiring company. No per-company query loop (no N+1). Sorted by vacancies, descending.
 *
 * `market`, `miamiOnly`, `hideOffshore` and `startupsOnly` flow straight into the SQL WHERE clauses. A market or
 * Miami filter suppresses the "new on the radar" verdict (see hiringDelta), which is a claim about the company.
 */
export async function getCompanyHiringSummaries(
  bdId: string,
  market?: MarketKey,
  miamiOnly?: boolean,
  hideOffshore?: boolean,
  startupsOnly?: boolean,
): Promise<HiringOverview> {
  const companies = await resolveHiringCompanies(market, miamiOnly, hideOffshore, startupsOnly, false);
  const { previousByCompany, lastSyncAt } = await getPreviousCountsAndSync(market, miamiOnly);
  if (!companies.size) return { summaries: [], lastSyncAt };

  const allMatchKeys = [
    ...new Set([...companies.values()].flatMap((c) => [...c.matchKeys])),
  ];

  const contactStats = allMatchKeys.length
    ? await db
        .select({ companyKey: contact.companyKey, count: sql<number>`count(*)::int` })
        .from(contact)
        .where(and(eq(contact.bdId, bdId), inArray(contact.companyKey, allMatchKeys)))
        .groupBy(contact.companyKey)
    : [];
  const statsByKey = new Map(
    contactStats
      .filter((s): s is typeof s & { companyKey: string } => s.companyKey !== null)
      .map((s) => [s.companyKey, s]),
  );

  const summaries: CompanyHiringSummary[] = [];
  for (const c of companies.values()) {
    const previousItCount = previousByCompany.get(c.companyKey) ?? 0;
    const summary: CompanyHiringSummary = {
      companyKey: c.companyKey,
      displayName: c.displayName,
      openItCount: c.openItCount,
      contactCount: 0,
      offshoreHeavy: c.offshoreHeavy,
      isStartup: c.isStartup,
      latamItCount: c.latamItCount,
      usItCount: c.usItCount,
      miamiItCount: c.miamiItCount,
      delta: hiringDelta({
        total: c.openItCount,
        previous: previousItCount,
        filtered: !!market || !!miamiOnly,
      }),
    };
    for (const key of c.matchKeys) summary.contactCount += statsByKey.get(key)?.count ?? 0;
    summaries.push(summary);
  }

  // Biggest hiring first (owner-approved redesign); name breaks ties so the order is stable.
  return { summaries: summaries.sort(compareByVacancies), lastSyncAt };
}

export interface HiringMatch {
  companyKey: string;
  displayName: string;
  openItCount: number;
  // See CompanyHiringSummary.offshoreItCount/latamItCount/offshoreHeavy
  // above — same derived signal, carried through the alias-aware index so
  // /outreach can rank on it and show the same badge without a second
  // lookup or a second computation.
  offshoreItCount: number;
  latamItCount: number;
  offshoreHeavy: boolean;
  // See ResolvedHiringCompany.isStartup/startupReason above — same derived
  // signal (well, not derived, straight from target_company), carried
  // through the alias-aware index so /outreach can filter/badge on it
  // without a second lookup.
  isStartup: boolean | null;
  startupReason: string | null;
}

/**
 * Company-key -> hiring info, keyed by every key that should count as "this
 * company" (canonical `target_company.company_key` plus every
 * `company_alias` pointing at it) — reuses the same alias resolution as
 * getCompanyHiringSummaries (via resolveHiringCompanies) rather than
 * duplicating it. Used by /outreach for an O(1) per-contact hiring lookup.
 * Not BD-scoped — job postings/target companies are shared data. Two fixed
 * queries regardless of caller. `market`, `miamiOnly`, `hideOffshore` and
 * `startupsOnly` flow into resolveHiringCompanies' SQL WHERE clause, same as
 * getCompanyHiringSummaries above.
 *
 * Wrapped in React `cache()`: dedupes identical argument tuples for the
 * lifetime of one request (same mechanism Next.js uses for `fetch`). It was
 * added when the `/contacts` "Contratando" badge (page.tsx, zero args) and
 * listOutreachCandidates (src/lib/outreach/queries.ts) both called this in
 * the same request. The badge no longer does — it only ever needed the key
 * set, which `getHiringCompanyKeys()` returns identically by construction
 * for the zero-arg case — so today the wrapper only pays off if some request
 * calls this twice with the same arguments. Harmless to keep.
 */
const getHiringMatchIndexCached = cache(async function getHiringMatchIndexUncached(
  market?: MarketKey,
  miamiOnly?: boolean,
  hideOffshore?: boolean,
  startupsOnly?: boolean,
): Promise<Map<string, HiringMatch>> {
  const companies = await resolveHiringCompanies(market, miamiOnly, hideOffshore, startupsOnly);
  const index = new Map<string, HiringMatch>();
  for (const c of companies.values()) {
    const match: HiringMatch = {
      companyKey: c.companyKey,
      displayName: c.displayName,
      openItCount: c.postings.length,
      offshoreItCount: c.offshoreItCount,
      latamItCount: c.latamItCount,
      isStartup: c.isStartup,
      startupReason: c.startupReason,
      offshoreHeavy: c.offshoreHeavy,
    };
    for (const key of c.matchKeys) index.set(key, match);
  }
  return index;
});

/**
 * Fixed-arity entry point: React `cache()` keys on the argument list
 * including its length, so `getHiringMatchIndex()` and
 * `getHiringMatchIndex(undefined, undefined, undefined, undefined)` would
 * otherwise miss each other. Always forwarding all four arguments makes the
 * two call sites above share one cached result.
 */
export function getHiringMatchIndex(
  market?: MarketKey,
  miamiOnly?: boolean,
  hideOffshore?: boolean,
  startupsOnly?: boolean,
): Promise<Map<string, HiringMatch>> {
  return getHiringMatchIndexCached(market, miamiOnly, hideOffshore, startupsOnly);
}

export interface CompanyPostingsForMessage {
  companyKey: string;
  displayName: string;
  // Bounded to DETAIL_ROW_LIMIT most recent postings (postedAt desc, id asc
  // tiebreak) — NOT every open posting for companies above that cap (e.g.
  // databricks: 525 open IT postings in production). Every count field below
  // is computed over the FULL open-posting set regardless of this cap, so
  // callers must read counts from those fields, never from
  // `postings.length` or by re-deriving from this array.
  postings: OpenPosting[];
  totalCount: number;
  newLast7DaysCount: number;
  latamCount: number;
  usCount: number;
  otherCount: number;
  miamiCount: number;
  offshoreCount: number;
}

// Cap on how many full posting rows (title/location/url) get fetched and
// returned for one company. Perf fix (owner-measured on production,
// 2026-09-28): with the whole-dataset scan removed, the single call still
// took ~970-1006ms for a company with many open postings — dominated by
// transferring hundreds of full rows just to render/sample a handful
// (databricks has 525 open IT postings, speechify 254). Every *count* below
// still reflects the full set via SQL aggregates, so this only bounds the
// row-level detail (titles, urls, per-posting locations/dates), not any
// number shown to a BD or fed to the outreach model.
const DETAIL_ROW_LIMIT = 100;

type CompanyPostingsRawRow = {
  id: string;
  title: string;
  location: string;
  market: string | null;
  url: string;
  postedAt: Date | string | null;
  firstSeen: Date | string;
  displayName: string;
  totalCount: number | string;
  newLast7Days: number | string;
  latamCount: number | string;
  usCount: number | string;
  miamiCount: number | string;
  offshoreCount: number | string;
}

/**
 * Full open-IT-posting detail (titles, locations, markets) for whichever
 * hiring company a single contact's `company_key` resolves to — including
 * via a `company_alias` match, same alias resolution as
 * getCompanyHiringSummaries/getHiringMatchIndex above. Used by the outreach
 * message generator (see src/app/outreach/actions.ts) and the /companies/[key]
 * record page, which need the actual posting titles/locations rather than
 * just the aggregate counts HiringMatch carries. Not BD-scoped — job
 * postings/target companies are shared data.
 *
 * Company-scoped, NOT resolveHiringCompanies() (perf fix, measured 2.3s on
 * production for a single-company call before this change — see
 * src/app/(app)/companies/[key]/page.tsx and outreach/actions.ts): loading
 * every open IT posting across all target companies plus every
 * `company_alias` row just to loop-scan in JS for one company was the single
 * most expensive call on the contact/company record pages. Two queries
 * instead of resolveHiringCompanies' two-plus-fan-out — (1) resolve
 * `companyKey` to its canonical `target_company.company_key`, trying it as a
 * canonical key first and falling back to a `company_alias.alias_key` match
 * (UNION, LIMIT 1: a `company_key` and an `alias_key` for the same
 * normalized name never disagree in practice), then (2) one query that joins
 * `job_posting`/`target_company` for a LIMITed, deterministically-ordered
 * page of detail rows AND cross-joins a same-company, non-correlated
 * subquery that computes every count (total, last-7-days, per-market,
 * miami, offshore) over the FULL open-posting set — computed once (the
 * subquery is independent of the outer row, not a per-row correlated
 * subquery), not per returned row. Returns null if the key doesn't resolve
 * to any company, or resolves to one with no open IT postings (same
 * "no result" behavior as before).
 */
export async function getCompanyPostingsForKey(
  companyKey: string,
): Promise<CompanyPostingsForMessage | null> {
  const canonicalRows = await db.execute<{ company_key: string }>(sql`
    select company_key from target_company where company_key = ${companyKey}
    union
    select company_key from company_alias where alias_key = ${companyKey}
    limit 1
  `);
  const canonicalKey = resolveCanonicalCompanyKey(canonicalRows);
  if (!canonicalKey) return null;

  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const rows = await db.execute<CompanyPostingsRawRow>(sql`
    select
      jp.id as id,
      jp.title as title,
      jp.location as location,
      jp.market as market,
      jp.url as url,
      jp.posted_at as "postedAt",
      jp.first_seen as "firstSeen",
      tc.display_name as "displayName",
      stats.total_count as "totalCount",
      stats.new_last_7_days as "newLast7Days",
      stats.latam_count as "latamCount",
      stats.us_count as "usCount",
      stats.miami_count as "miamiCount",
      stats.offshore_count as "offshoreCount"
    from job_posting jp
    inner join target_company tc on tc.company_key = jp.company_key
    cross join (
      select
        count(*)::int as total_count,
        -- new_last_7_days matches the contacts/[id] record's original "new"
        -- definition (postedAt-based), not getCompanyHiringSummaries'
        -- firstSeen-based one — same field this replaces
        -- (companyPostings.postings.filter((p) => p.postedAt && p.postedAt
        -- > sevenDaysAgo)), unchanged.
        count(*) filter (where jp2.posted_at > ${sevenDaysAgoIso}::timestamptz)::int as new_last_7_days,
        count(*) filter (where jp2.market = 'latam')::int as latam_count,
        count(*) filter (where jp2.market = 'us')::int as us_count,
        count(*) filter (where jp2.is_miami = true)::int as miami_count,
        count(*) filter (where jp2.is_offshore_hub = true)::int as offshore_count
      from job_posting jp2
      where jp2.company_key = ${canonicalKey}
        and jp2.is_it = true
        and ${openFreshPostingSql("jp2")}
    ) stats
    where jp.company_key = ${canonicalKey}
      and jp.is_it = true
      and ${openFreshPostingSql("jp")}
    order by jp.posted_at desc nulls last, jp.id asc
    limit ${DETAIL_ROW_LIMIT}
  `);

  if (!rows.length) return null;

  const first = rows[0];
  const totalCount = Number(first.totalCount);
  const latamCount = Number(first.latamCount);
  const usCount = Number(first.usCount);

  return {
    companyKey: canonicalKey,
    displayName: first.displayName,
    postings: rows.map((r) =>
      toOpenPosting({
        id: r.id,
        title: r.title,
        location: r.location,
        market: r.market,
        url: r.url,
        // `job_posting.posted_at`/`first_seen` are `timestamptz` columns as
        // of the slice-2 migration (openspec/decisions/2026-09-30-timestamptz-
        // migration-plan.md), but raw `db.execute` still returns them as
        // wire strings rather than typed `Date`s, so they still need
        // parseDbTimestamp — it trusts an already offset-bearing string as-is
        // (see src/lib/db/timestamp.ts), so this stays correct both before
        // and after that migration.
        postedAt: r.postedAt ? parseDbTimestamp(r.postedAt) : null,
        firstSeen: parseDbTimestamp(r.firstSeen),
      }),
    ),
    totalCount,
    newLast7DaysCount: Number(first.newLast7Days),
    latamCount,
    usCount,
    otherCount: totalCount - latamCount - usCount,
    miamiCount: Number(first.miamiCount),
    offshoreCount: Number(first.offshoreCount),
  };
}

/**
 * The set of normalized company keys (canonical `target_company.company_key`
 * values plus any `company_alias` rows pointing at them) that currently have
 * at least one open IT posting. Used to badge contacts on the home page as
 * "hiring" — public hiring data, not BD-scoped — with exactly one query
 * regardless of how many contacts are on the visible page.
 */
export async function getHiringCompanyKeys(): Promise<Set<string>> {
  const rows = await db.execute<{ key: string }>(sql`
    select tc.company_key as key
    from target_company tc
    where exists (
      select 1 from job_posting jp
      where jp.company_key = tc.company_key and jp.is_it = true and ${openFreshPostingSql("jp")}
    )
    union
    select ca.alias_key as key
    from company_alias ca
    join target_company tc on tc.company_key = ca.company_key
    where exists (
      select 1 from job_posting jp
      where jp.company_key = tc.company_key and jp.is_it = true and ${openFreshPostingSql("jp")}
    )
  `);
  return new Set(rows.map((r) => r.key));
}
