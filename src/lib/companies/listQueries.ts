import { and, asc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { activity, bd, company, person } from "@/db/schema";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
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
 * count and a batched last-activity MAX for exactly this page's company
 * keys (never one query per row).
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
): Promise<CompanyListPage> {
  const conditions: SQL[] = [];
  if (stage) conditions.push(eq(company.relationshipStage, stage));
  if (view === "mine") conditions.push(eq(company.ownerBdId, meBdId));
  if (industryFilter) conditions.push(eq(company.industry, industryFilter));
  if (ownerFilter) conditions.push(eq(company.ownerBdId, ownerFilter));

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
  const companyRows = await db
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
    })
    .from(company)
    .leftJoin(owner, eq(company.ownerBdId, owner.id))
    .where(where)
    .orderBy(company.displayName)
    .limit(pageSize)
    .offset(offset);

  if (!companyRows.length) {
    return { rows: [], total, page, pageSize, totalPages };
  }

  const keys = companyRows.map((r) => r.companyKey);

  // Two batched queries for exactly this page's keys — never N+1, never an
  // unbounded scan (data-builder.md rule 5/7).
  const [contactCounts, lastActivityRows] = await Promise.all([
    db
      .select({ companyKey: person.companyKey, count: sql<number>`count(*)::int` })
      .from(person)
      .where(inArray(person.companyKey, keys))
      .groupBy(person.companyKey),
    db
      .select({
        companyKey: activity.companyKey,
        // Raw computed timestamptz expression — postgres-js returns this as
        // a string at runtime, not a parsed Date (same class of bug
        // effectiveActivityTime.ts's own doc comment describes for
        // listQueries.ts); normalized to Date below, never left as-is.
        at: sql<Date | string>`max(${effectiveActivityAtSql()})`,
      })
      .from(activity)
      .where(inArray(activity.companyKey, keys))
      .groupBy(activity.companyKey),
  ]);

  const contactCountByKey = new Map(
    contactCounts.filter((c): c is typeof c & { companyKey: string } => c.companyKey !== null).map((c) => [c.companyKey, c.count]),
  );
  const lastActivityByKey = new Map(
    lastActivityRows
      .filter((a): a is typeof a & { companyKey: string } => a.companyKey !== null)
      .map((a) => [a.companyKey, a.at]),
  );

  const rows: CompanyListRow[] = companyRows.map((r) => {
    const rawAt = lastActivityByKey.get(r.companyKey);
    return {
      companyKey: r.companyKey,
      displayName: r.displayName,
      domain: r.domain,
      relationshipStage: r.relationshipStage,
      contactCount: contactCountByKey.get(r.companyKey) ?? 0,
      hiring: hiringIndex.get(r.companyKey) ?? null,
      lastActivityAt: rawAt ? new Date(rawAt) : null,
      industry: r.industry,
      ownerBdId: r.ownerBdId,
      ownerName: r.ownerName,
      city: r.city,
      country: r.country,
    };
  });

  return { rows, total, page, pageSize, totalPages };
}

export interface CompanyViewCounts {
  all: number;
  mine: number;
  hiring: number;
}

/** View-tab counts (companies.html:65) — three fixed queries, no per-row cost. */
export async function getCompanyViewCounts(
  meBdId: string,
  hiringIndex: Map<string, HiringMatch>,
): Promise<CompanyViewCounts> {
  const hiringKeys = [...hiringIndex.keys()];
  const [[allRow], [mineRow], hiringRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(company),
    db.select({ count: sql<number>`count(*)::int` }).from(company).where(eq(company.ownerBdId, meBdId)),
    hiringKeys.length
      ? db.select({ count: sql<number>`count(*)::int` }).from(company).where(inArray(company.companyKey, hiringKeys))
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
