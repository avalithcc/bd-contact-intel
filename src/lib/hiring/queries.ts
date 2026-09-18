import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { companyAlias, contact, jobPosting, targetCompany } from "@/db/schema";
import type { RoleGroupKey } from "@/lib/roleGroups";
import type { MarketKey } from "@/lib/hiring/markets";

export interface OpenPosting {
  id: string;
  title: string;
  location: string;
  market: MarketKey;
  url: string;
  postedAt: Date | null;
  firstSeen: Date;
}

export interface CompanyHiringSummary {
  companyKey: string;
  displayName: string;
  openItCount: number;
  newLast7Days: number;
  postings: OpenPosting[];
  // The signed-in BD's own crossover with this company (see
  // getCompanyHiringSummaries below).
  contactCount: number;
  leadershipContactCount: number;
  // Whether this company currently has at least one open IT posting in an
  // offshore delivery hub (see src/lib/hiring/markets.ts#isOffshoreHub) —
  // computed below from the same postings already fetched, no extra query.
  // A deprioritizing signal, not a disqualifying one (see the comment on
  // resolveHiringCompanies below).
  hiresOffshore: boolean;
}

// Role groups considered "leadership" for the hiring crossover — the
// contacts most worth reaching out to at a company that's actively hiring.
// Exported so other views built on the same signal (see
// src/lib/outreach/queries.ts) use the identical definition instead of
// re-declaring it.
export const LEADERSHIP_ROLE_GROUPS: RoleGroupKey[] = [
  "c_level_tech",
  "c_level_business",
  "eng_leadership",
  "engineering_manager",
];

interface ResolvedHiringCompany {
  companyKey: string;
  displayName: string;
  postings: OpenPosting[];
  // Every contact.company_key value that should count as "works there":
  // the target company's own key plus any company_alias rows pointing at
  // it.
  matchKeys: Set<string>;
  // True when at least one of `postings` is in an offshore delivery hub.
  // Derived, not stored: recomputed from the open postings already in this
  // map every time they're fetched, so it stays truthful as postings open
  // and close rather than going stale like a cached column on
  // target_company would.
  hiresOffshore: boolean;
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
 * `hideOffshore`, when true, excludes companies that have at least one open
 * posting in an offshore delivery hub (see
 * src/lib/hiring/markets.ts#isOffshoreHub) entirely from the result — via a
 * correlated `NOT EXISTS` subquery in query (1)'s SQL WHERE clause, not a
 * post-fetch JS filter, so it never changes the query count. This is an
 * opt-in hide, off by default: such companies are a weaker but not
 * worthless prospect (see the `hiresOffshore` field below), so the default
 * behavior is to show and deprioritize them, never to drop them silently.
 */
export async function resolveHiringCompanies(
  market?: MarketKey,
  miamiOnly?: boolean,
  hideOffshore?: boolean,
): Promise<Map<string, ResolvedHiringCompany>> {
  const openPostings = await db
    .select({
      id: jobPosting.id,
      companyKey: jobPosting.companyKey,
      displayName: targetCompany.displayName,
      title: jobPosting.title,
      location: jobPosting.location,
      market: jobPosting.market,
      isOffshoreHub: jobPosting.isOffshoreHub,
      url: jobPosting.url,
      postedAt: jobPosting.postedAt,
      firstSeen: jobPosting.firstSeen,
    })
    .from(jobPosting)
    .innerJoin(targetCompany, eq(jobPosting.companyKey, targetCompany.companyKey))
    .where(
      and(
        eq(jobPosting.isIt, true),
        isNull(jobPosting.closedAt),
        market ? eq(jobPosting.market, market) : undefined,
        miamiOnly ? eq(jobPosting.isMiami, true) : undefined,
        hideOffshore
          ? sql`not exists (
              select 1 from job_posting jp2
              where jp2.company_key = ${jobPosting.companyKey}
                and jp2.is_offshore_hub = true
                and jp2.closed_at is null
            )`
          : undefined,
      ),
    )
    .orderBy(desc(jobPosting.postedAt));

  const byCompany = new Map<string, ResolvedHiringCompany>();
  if (!openPostings.length) return byCompany;

  for (const p of openPostings) {
    const entry = byCompany.get(p.companyKey) ?? {
      companyKey: p.companyKey,
      displayName: p.displayName,
      postings: [],
      matchKeys: new Set([p.companyKey]),
      hiresOffshore: false,
    };
    entry.postings.push({
      id: p.id,
      title: p.title,
      location: p.location,
      // Rows synced before the market column was backfilled are null;
      // treat those as "other" rather than crashing the UI on an
      // unclassified value (see scripts/backfill-posting-markets.ts).
      market: (p.market as MarketKey | null) ?? "other",
      url: p.url,
      postedAt: p.postedAt,
      firstSeen: p.firstSeen,
    });
    if (p.isOffshoreHub) entry.hiresOffshore = true;
    byCompany.set(p.companyKey, entry);
  }

  const companyKeys = [...byCompany.keys()];
  const aliases = await db
    .select({ aliasKey: companyAlias.aliasKey, companyKey: companyAlias.companyKey })
    .from(companyAlias)
    .where(inArray(companyAlias.companyKey, companyKeys));
  for (const a of aliases) byCompany.get(a.companyKey)?.matchKeys.add(a.aliasKey);

  return byCompany;
}

/**
 * Target companies that currently have at least one open IT posting, along
 * with those postings for the expandable detail list on /hiring, and — for
 * the given BD — how many of their contacts work there and how many of
 * those are in a leadership role group (see LEADERSHIP_ROLE_GROUPS).
 *
 * Three fixed queries regardless of how many companies/postings/contacts
 * exist: the two behind resolveHiringCompanies() above, plus one GROUP BY
 * over `contact` for every key (canonical + alias) that resolves to any
 * hiring company. No per-company query loop (no N+1).
 *
 * `market`, `miamiOnly` and `hideOffshore`, when set, flow straight into
 * resolveHiringCompanies' SQL WHERE clause — same query count either way.
 */
export async function getCompanyHiringSummaries(
  bdId: string,
  market?: MarketKey,
  miamiOnly?: boolean,
  hideOffshore?: boolean,
): Promise<CompanyHiringSummary[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const companies = await resolveHiringCompanies(market, miamiOnly, hideOffshore);
  if (!companies.size) return [];

  const allMatchKeys = [
    ...new Set([...companies.values()].flatMap((c) => [...c.matchKeys])),
  ];

  const contactStats = allMatchKeys.length
    ? await db
        .select({
          companyKey: contact.companyKey,
          count: sql<number>`count(*)::int`,
          // `inArray` renders an IN (...) list; interpolating the array
          // directly would render a record literal, which Postgres cannot
          // cast to text[].
          leadershipCount: sql<number>`count(*) filter (where ${inArray(contact.roleGroup, LEADERSHIP_ROLE_GROUPS)})::int`,
        })
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
    const summary: CompanyHiringSummary = {
      companyKey: c.companyKey,
      displayName: c.displayName,
      openItCount: c.postings.length,
      newLast7Days: c.postings.filter((p) => p.firstSeen >= sevenDaysAgo).length,
      postings: c.postings,
      contactCount: 0,
      leadershipContactCount: 0,
      hiresOffshore: c.hiresOffshore,
    };
    for (const key of c.matchKeys) {
      const stats = statsByKey.get(key);
      if (!stats) continue;
      summary.contactCount += stats.count;
      summary.leadershipContactCount += stats.leadershipCount;
    }
    summaries.push(summary);
  }

  // Companies where the BD already has contacts are the actionable
  // signal — surface those first, then by open IT posting count. A company
  // that also hires offshore is the lowest-priority tiebreak — it only
  // decides the order between two otherwise-equivalent companies, never
  // overriding the contact-crossover or posting-count signals above.
  return summaries.sort((a, b) => {
    const aHas = a.contactCount > 0 ? 1 : 0;
    const bHas = b.contactCount > 0 ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    if (a.openItCount !== b.openItCount) return b.openItCount - a.openItCount;
    if (a.hiresOffshore !== b.hiresOffshore) return a.hiresOffshore ? 1 : -1;
    return 0;
  });
}

export interface HiringMatch {
  companyKey: string;
  displayName: string;
  openItCount: number;
  // See CompanyHiringSummary.hiresOffshore above — same derived signal,
  // carried through the alias-aware index so /outreach can rank on it
  // without a second lookup.
  hiresOffshore: boolean;
}

/**
 * Company-key -> hiring info, keyed by every key that should count as "this
 * company" (canonical `target_company.company_key` plus every
 * `company_alias` pointing at it) — reuses the same alias resolution as
 * getCompanyHiringSummaries (via resolveHiringCompanies) rather than
 * duplicating it. Used by /outreach for an O(1) per-contact hiring lookup.
 * Not BD-scoped — job postings/target companies are shared data. Two fixed
 * queries regardless of caller. `market`, `miamiOnly` and `hideOffshore`
 * flow into resolveHiringCompanies' SQL WHERE clause, same as
 * getCompanyHiringSummaries above.
 */
export async function getHiringMatchIndex(
  market?: MarketKey,
  miamiOnly?: boolean,
  hideOffshore?: boolean,
): Promise<Map<string, HiringMatch>> {
  const companies = await resolveHiringCompanies(market, miamiOnly, hideOffshore);
  const index = new Map<string, HiringMatch>();
  for (const c of companies.values()) {
    const match: HiringMatch = {
      companyKey: c.companyKey,
      displayName: c.displayName,
      openItCount: c.postings.length,
      hiresOffshore: c.hiresOffshore,
    };
    for (const key of c.matchKeys) index.set(key, match);
  }
  return index;
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
      where jp.company_key = tc.company_key and jp.is_it = true and jp.closed_at is null
    )
    union
    select ca.alias_key as key
    from company_alias ca
    join target_company tc on tc.company_key = ca.company_key
    where exists (
      select 1 from job_posting jp
      where jp.company_key = tc.company_key and jp.is_it = true and jp.closed_at is null
    )
  `);
  return new Set(rows.map((r) => r.key));
}
