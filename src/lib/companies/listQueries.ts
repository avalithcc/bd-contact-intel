import { and, asc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { bd, company } from "@/db/schema";
import type { AccountType } from "@/lib/companies/accountTypeFilter";
import type { ClientStatusFilter } from "@/lib/companies/clientStatusFilter";
import type { LinkedinPresence } from "@/lib/companies/linkedinPresence";
import { companyContactCountsQuery } from "@/lib/companies/contactCounts";
import { companyListConditions } from "@/lib/companies/listConditions";
import { companySearchCondition } from "@/lib/companies/searchCondition";
import { companyLastActivity, companyListOrderBy } from "@/lib/companies/lastActivitySignal";
import { parseDbTimestamp } from "@/lib/db/timestamp";
import type { HiringMatch } from "@/lib/hiring/queries";

const owner = alias(bd, "company_list_owner");

export type CompanyListView = "all" | "mine" | "hiring";

export interface CompanyListRow {
  companyKey: string;
  displayName: string;
  domain: string | null;
  relationshipStage: string | null;
  contactCount: number;
  hiring: HiringMatch | null;
  lastActivityAt: Date | null;
  // Wired for real in mockup-port c05 (D1 resolved — migration 0017,
  // feat/company-fields-03-require-headers). `industry`/`city`/`country`
  // come straight off `company`; `ownerName` needs the join below.
  industry: string | null;
  ownerBdId: string | null;
  ownerName: string | null;
  city: string | null;
  country: string | null;
  /** Stored `linkedin.com/company/<slug>` (no scheme); null = no page set. */
  linkedinUrl: string | null;
  /** "active" | "inactive" | null (never stated). */
  clientStatus: string | null;
}

export interface CompanyListPage {
  rows: CompanyListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * `/companies` list (mockups/companies.html), same index shape as
 * `/contacts`'s `getContactListPage`: one bounded page at a time (14,240
 * companies total — never a full scan), a batched contacts-per-company
 * count for exactly this page's company keys (never one query per row).
 * Rows are ordered by last activity (direct or via contacts), most recent
 * first, blanks last, with display_name/company_key tiebreaks — see
 * lastActivitySignal.ts.
 *
 * `view` narrows the WHERE clause in SQL, not a post-fetch JS filter:
 * - "all": no extra condition.
 * - "mine": `owner_bd_id = meBdId` (mockup-port c05: now the real owner
 *   column — this used `created_by_bd_id` as an interim stand-in before D1
 *   landed; that was never a real "owner" concept, just whoever happened to
 *   create the row).
 * - "hiring": `company_key IN (hiringIndex keys)`. The index (see
 *   getHiringMatchIndex) is already keyed by every canonical company key
 *   AND every company_alias pointing at it, resolving to the same
 *   HiringMatch — so a plain membership check on `company.companyKey`
 *   (always the canonical key) is correct without a second alias lookup.
 *
 * `hiringIndex` is fetched once per request by the caller (page.tsx) via
 * the cached `getHiringMatchIndex()` and threaded through here — this
 * function never calls it itself, so it's never computed twice.
 *
 * `industry`/`ownerBdId` filters (mockup-port c05) are index-backed
 * (`company_industry_idx`/`company_owner_idx`, migration 0017) — the only
 * two D1 fields the list filters on, per the owner's instruction to only
 * add filters the new indexes actually support.
 *
 * `accountTypeFilter` (BACKLOG.md Layer 3 "account-type-filter") is a plain
 * equality WHERE condition on `company.account_type`, same shape as the
 * others above — zero extra round trips, since it's folded into this same
 * count query and this same page query rather than adding a new one. No
 * index backs it (unlike industry/owner): with only 30 partner / 2 client
 * rows out of ~14,240 companies, a sequential scan over this single column
 * is negligible next to the pagination query's own cost, so one wasn't
 * added speculatively (PERFORMANCE.md: round trips are the budget, not
 * every column needing its own index).
 *
 * `clientStatusFilter` is the same shape (equality on `company.client_status`,
 * no index, folded into the same two queries). The conditions are assembled by
 * `companyListConditions` (listConditions.ts) so their composition is tested.
 *
 * `linkedinFilter` (any / with / without) is `IS [NOT] NULL` on `linkedin_url`,
 * same shape, same two queries, no index.
 *
 * `q` (owner report 2026-09-30: "no tengo buscador de empresas") is folded
 * into this SAME `conditions[]` array — the total count query and the page
 * query below therefore always agree on which rows match, same as every
 * other filter here. `companySearchCondition` (searchCondition.ts) is the
 * one place the match rule lives; `getCompanyViewCounts` below takes the
 * same `q` and applies the identical condition so the view-tab badges can
 * never disagree with what the table actually shows.
 */
export async function getCompanyListPage(
  view: CompanyListView,
  stage: string | undefined,
  meBdId: string,
  hiringIndex: Map<string, HiringMatch>,
  page: number,
  pageSize: number,
  industryFilter?: string,
  ownerFilter?: string,
  accountTypeFilter?: AccountType,
  q?: string,
  clientStatusFilter?: ClientStatusFilter,
  linkedinFilter?: LinkedinPresence,
): Promise<CompanyListPage> {
  const conditions = companyListConditions({
    view,
    meBdId,
    stage,
    industry: industryFilter,
    owner: ownerFilter,
    accountType: accountTypeFilter,
    clientStatus: clientStatusFilter,
    linkedin: linkedinFilter,
    q,
  });

  let hiringKeys: string[] | null = null;
  if (view === "hiring") {
    hiringKeys = [...hiringIndex.keys()];
    if (hiringKeys.length === 0) {
      return { rows: [], total: 0, page, pageSize, totalPages: 0 };
    }
    conditions.push(inArray(company.companyKey, hiringKeys));
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(company).where(where);
  const total = totalRow?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const offset = (page - 1) * pageSize;
  // lastActivityAt is computed BEFORE the LIMIT (two pre-aggregated CTEs, see
  // lastActivitySignal.ts) because the page is ordered by it. The joins are
  // 1:1 on a unique key, so `total` above and these page slices stay
  // consistent. It is a computed timestamptz that postgres-js returns as a
  // possibly offset-less string, not a Date: pinned to UTC below via
  // parseDbTimestamp, never left as-is.
  const la = companyLastActivity();
  const companyRows = await db
    .with(la.direct, la.viaContact)
    .select({
      companyKey: company.companyKey,
      displayName: company.displayName,
      domain: company.domain,
      relationshipStage: company.relationshipStage,
      industry: company.industry,
      ownerBdId: company.ownerBdId,
      ownerName: owner.name,
      city: company.city,
      country: company.country,
      linkedinUrl: company.linkedinUrl,
      clientStatus: company.clientStatus,
      lastActivityAt: la.lastActivityAt.as("last_activity_at"),
    })
    .from(company)
    .leftJoin(owner, eq(company.ownerBdId, owner.id))
    .leftJoin(la.direct, la.joinDirect)
    .leftJoin(la.viaContact, la.joinViaContact)
    .where(where)
    .orderBy(...companyListOrderBy(la.lastActivityAt))
    .limit(pageSize)
    .offset(offset);

  if (!companyRows.length) {
    return { rows: [], total, page, pageSize, totalPages };
  }

  const keys = companyRows.map((r) => r.companyKey);

  // One batched query for exactly this page's keys — never N+1, never an
  // unbounded scan (data-builder.md rule 5/7). Excludes merged-away people so
  // the count matches the company's own record (see contactCounts.ts).
  const contactCounts = await companyContactCountsQuery(db, keys);

  const contactCountByKey = new Map(
    contactCounts.filter((c): c is typeof c & { companyKey: string } => c.companyKey !== null).map((c) => [c.companyKey, c.count]),
  );

  const rows: CompanyListRow[] = companyRows.map((r) => {
    return {
      companyKey: r.companyKey,
      displayName: r.displayName,
      domain: r.domain,
      relationshipStage: r.relationshipStage,
      contactCount: contactCountByKey.get(r.companyKey) ?? 0,
      hiring: hiringIndex.get(r.companyKey) ?? null,
      lastActivityAt: r.lastActivityAt ? parseDbTimestamp(r.lastActivityAt) : null,
      industry: r.industry,
      ownerBdId: r.ownerBdId,
      ownerName: r.ownerName,
      city: r.city,
      country: r.country,
      linkedinUrl: r.linkedinUrl,
      clientStatus: r.clientStatus,
    };
  });

  return { rows, total, page, pageSize, totalPages };
}

export interface CompanyViewCounts {
  all: number;
  mine: number;
  hiring: number;
}

/**
 * View-tab counts (companies.html:65) — three fixed queries, no per-row
 * cost. `q` (owner report 2026-09-30) is ANDed into each of the three
 * view's own condition — same `companySearchCondition` the page/count query
 * above uses, so a BD searching "acme" sees the All/Mine/Hiring tab badges
 * agree with the table, exactly like the account-type filter and
 * role-visibility work (getSystemViewCounts) did for /contacts.
 */
export async function getCompanyViewCounts(
  meBdId: string,
  hiringIndex: Map<string, HiringMatch>,
  q?: string,
): Promise<CompanyViewCounts> {
  const hiringKeys = [...hiringIndex.keys()];
  const searchWhere = companySearchCondition(q);
  const mineWhere = searchWhere ? and(eq(company.ownerBdId, meBdId), searchWhere) : eq(company.ownerBdId, meBdId);
  const hiringWhere = searchWhere
    ? and(inArray(company.companyKey, hiringKeys), searchWhere)
    : inArray(company.companyKey, hiringKeys);
  const [[allRow], [mineRow], hiringRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(company).where(searchWhere),
    db.select({ count: sql<number>`count(*)::int` }).from(company).where(mineWhere),
    hiringKeys.length
      ? db.select({ count: sql<number>`count(*)::int` }).from(company).where(hiringWhere)
      : Promise.resolve([{ count: 0 }]),
  ]);
  return {
    all: allRow?.count ?? 0,
    mine: mineRow?.count ?? 0,
    hiring: hiringRows[0]?.count ?? 0,
  };
}

export interface CompanyFilterOptions {
  industries: string[];
}

const MAX_INDUSTRY_OPTIONS = 100;

/**
 * Distinct industry values for the "Agregar filtro" → Industria select
 * (mockup-port c05). Bounded (`MAX_INDUSTRY_OPTIONS`) and index-backed
 * (`company_industry_idx`, migration 0017) — a `DISTINCT` scan over a
 * text column with 14,240 rows, capped so a long tail of one-off values
 * can never make this list unbounded. Owner options reuse
 * `listOwnerOptions()` (src/lib/contacts/bulkOwnerDb.ts) directly — it's
 * already a generic `bd` list, not Contact-specific.
 */
export async function getCompanyFilterOptions(): Promise<CompanyFilterOptions> {
  const rows = await db
    .selectDistinct({ industry: company.industry })
    .from(company)
    .where(isNotNull(company.industry))
    .orderBy(asc(company.industry))
    .limit(MAX_INDUSTRY_OPTIONS);
  return { industries: rows.map((r) => r.industry).filter((v): v is string => v !== null) };
}
