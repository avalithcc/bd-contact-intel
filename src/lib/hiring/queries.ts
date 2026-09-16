import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { companyAlias, contact, jobPosting, targetCompany } from "@/db/schema";
import type { RoleGroupKey } from "@/lib/roleGroups";

export interface OpenPosting {
  id: string;
  title: string;
  location: string;
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
}

// Role groups considered "leadership" for the hiring crossover — the
// contacts most worth reaching out to at a company that's actively hiring.
const LEADERSHIP_ROLE_GROUPS: RoleGroupKey[] = [
  "c_level_tech",
  "c_level_business",
  "eng_leadership",
  "engineering_manager",
];

/**
 * Target companies that currently have at least one open IT posting, along
 * with those postings for the expandable detail list on /hiring, and — for
 * the given BD — how many of their contacts work there and how many of
 * those are in a leadership role group (see LEADERSHIP_ROLE_GROUPS).
 *
 * Matching a contact to a target company goes through `contact.company_key`
 * (normalized at import/backfill time, see src/lib/queries.ts#upsertContacts
 * and scripts/backfill-company-keys.ts) against EITHER the target's own
 * `company_key` OR any row in `company_alias` pointing at it — a contact's
 * LinkedIn company name doesn't always normalize to the same key as the
 * target company (e.g. a legal entity vs. the brand name), and aliases
 * bridge that gap without needing per-row fuzzy matching in the query.
 *
 * The number of target companies is expected to stay small (tens), so this
 * is three fixed queries regardless of how many companies/postings/contacts
 * exist: (1) open IT postings joined with their target company's display
 * name, (2) the aliases for those companies, (3) one GROUP BY over `contact`
 * for every key (canonical + alias) that resolves to any of those
 * companies. No per-company query loop (no N+1).
 */
export async function getCompanyHiringSummaries(
  bdId: string,
): Promise<CompanyHiringSummary[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const openPostings = await db
    .select({
      id: jobPosting.id,
      companyKey: jobPosting.companyKey,
      displayName: targetCompany.displayName,
      title: jobPosting.title,
      location: jobPosting.location,
      url: jobPosting.url,
      postedAt: jobPosting.postedAt,
      firstSeen: jobPosting.firstSeen,
    })
    .from(jobPosting)
    .innerJoin(targetCompany, eq(jobPosting.companyKey, targetCompany.companyKey))
    .where(and(eq(jobPosting.isIt, true), isNull(jobPosting.closedAt)))
    .orderBy(desc(jobPosting.postedAt));

  if (!openPostings.length) return [];

  const companyKeys = [...new Set(openPostings.map((p) => p.companyKey))];

  const aliases = await db
    .select({ aliasKey: companyAlias.aliasKey, companyKey: companyAlias.companyKey })
    .from(companyAlias)
    .where(inArray(companyAlias.companyKey, companyKeys));

  // For each target company, the full set of contact.company_key values
  // that should count as "works there": its own key plus any aliases.
  const matchKeysByCompany = new Map<string, Set<string>>();
  for (const key of companyKeys) matchKeysByCompany.set(key, new Set([key]));
  for (const a of aliases) matchKeysByCompany.get(a.companyKey)?.add(a.aliasKey);

  const allMatchKeys = [...new Set([...companyKeys, ...aliases.map((a) => a.aliasKey)])];

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

  const byCompany = new Map<string, CompanyHiringSummary>();
  for (const p of openPostings) {
    const summary = byCompany.get(p.companyKey) ?? {
      companyKey: p.companyKey,
      displayName: p.displayName,
      openItCount: 0,
      newLast7Days: 0,
      postings: [],
      contactCount: 0,
      leadershipContactCount: 0,
    };
    summary.openItCount += 1;
    if (p.firstSeen >= sevenDaysAgo) summary.newLast7Days += 1;
    summary.postings.push({
      id: p.id,
      title: p.title,
      location: p.location,
      url: p.url,
      postedAt: p.postedAt,
      firstSeen: p.firstSeen,
    });
    byCompany.set(p.companyKey, summary);
  }

  for (const [companyKey, summary] of byCompany) {
    for (const key of matchKeysByCompany.get(companyKey) ?? [companyKey]) {
      const stats = statsByKey.get(key);
      if (!stats) continue;
      summary.contactCount += stats.count;
      summary.leadershipContactCount += stats.leadershipCount;
    }
  }

  // Companies where the BD already has contacts are the actionable
  // signal — surface those first, then by open IT posting count.
  return [...byCompany.values()].sort((a, b) => {
    const aHas = a.contactCount > 0 ? 1 : 0;
    const bHas = b.contactCount > 0 ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return b.openItCount - a.openItCount;
  });
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
