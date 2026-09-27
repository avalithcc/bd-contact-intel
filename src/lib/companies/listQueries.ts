import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { activity, company, person } from "@/db/schema";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
import type { HiringMatch } from "@/lib/hiring/queries";

export type CompanyListView = "all" | "mine" | "hiring";

export interface CompanyListRow {
  companyKey: string;
  displayName: string;
  domain: string | null;
  relationshipStage: string | null;
  contactCount: number;
  hiring: HiringMatch | null;
  lastActivityAt: Date | null;
  // Pending D1 (owner-approved 2026-09-26) — see listMappers.ts. `null`
  // until the parallel data branch (feat/company-fields-01…) adds these
  // columns to `company` and this query starts selecting them for real.
  industry: string | null;
  ownerName: string | null;
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
 * - "mine": `created_by_bd_id = meBdId`. Interim stand-in for a real
 *   "owner" concept — `company` has no `owner_bd_id` yet (pending D1,
 *   being added by feat/company-fields-01…). Documented in
 *   companies-checklist.md; swap to the real owner column once that
 *   branch merges.
 * - "hiring": `company_key IN (hiringIndex keys)`. The index (see
 *   getHiringMatchIndex) is already keyed by every canonical company key
 *   AND every company_alias pointing at it, resolving to the same
 *   HiringMatch — so a plain membership check on `company.companyKey`
 *   (always the canonical key) is correct without a second alias lookup.
 *
 * `hiringIndex` is fetched once per request by the caller (page.tsx) via
 * the cached `getHiringMatchIndex()` and threaded through here — this
 * function never calls it itself, so it's never computed twice.
 */
export async function getCompanyListPage(
  view: CompanyListView,
  stage: string | undefined,
  meBdId: string,
  hiringIndex: Map<string, HiringMatch>,
  page: number,
  pageSize: number,
): Promise<CompanyListPage> {
  const conditions: SQL[] = [];
  if (stage) conditions.push(eq(company.relationshipStage, stage));
  if (view === "mine") conditions.push(eq(company.createdByBdId, meBdId));

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
    .select()
    .from(company)
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
      industry: null,
      ownerName: null,
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
    db.select({ count: sql<number>`count(*)::int` }).from(company).where(eq(company.createdByBdId, meBdId)),
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
