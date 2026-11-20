import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, tender, type Tender } from "@/db/schema";
import { budgetCellState, type BudgetCell, type BudgetCellInput } from "./budgetCell";
import { tenderNotDecidedNoSql } from "./relevanceSql";
import { tenderTiming, type TenderTiming } from "./timing";

/** The page shows everything the portal gave us; this bounds the read, not the screen (the live set is 5 to 17 rows). */
export const TENDER_LIST_LIMIT = 500;

/** `ownerName` is the owner BD's name, null when nobody owns the tender. */
export type TenderListRow = Tender & TenderTiming & { ownerName: string | null; budgetCell: BudgetCell };

/**
 * The newest document's budget facts, as one small jsonb object per tender (a correlated subquery on the
 * tender_document_tender_idx index, so no N+1 and none of the large analysis text leaves the database). Null when the
 * tender has no document. `jsonb_exists` rather than the `?` operator, which a driver would read as a placeholder.
 */
const budgetFactsSql = sql<unknown>`(
  select jsonb_build_object(
    'hasAnalysis', d.analysis is not null,
    'included', d.analysis -> 'economicsIncluded',
    'hasKey', coalesce(jsonb_exists(d.analysis -> 'economics', 'budgetAmount'), false),
    'amount', d.analysis -> 'economics' -> 'budgetAmount')
  from tender_document d where d.tender_id = ${tender.id} order by d.created_at desc limit 1)`;

/** The driver may hand a jsonb back parsed or as text; both are accepted. */
function toBudgetCell(raw: unknown): BudgetCell {
  const facts = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
  if (!facts) return budgetCellState({ hasDocument: false, hasAnalysis: false, economicsIncluded: null, hasBudgetAmountKey: false, budgetAmount: null });
  const input: BudgetCellInput = {
    hasDocument: true,
    hasAnalysis: facts.hasAnalysis === true,
    economicsIncluded: typeof facts.included === "boolean" ? facts.included : null,
    hasBudgetAmountKey: facts.hasKey === true,
    budgetAmount: typeof facts.amount === "string" ? facts.amount : null,
  };
  return budgetCellState(input);
}

/** "relevant": what the BD works from. "all": everything the table holds, discarded and closed included. */
export type TenderView = "relevant" | "all";

export interface TenderList {
  rows: TenderListRow[];
  /** Rows matching the view, which can exceed `rows` only past TENDER_LIST_LIMIT. */
  total: number;
  /** Every row in the table whatever the view, so the page can say how many the default view leaves out. */
  all: number;
}

/**
 * Default view ("relevant"): open tenders that are not decided "no" (a human's call beats the model's; no verdict at all
 * counts as shown), the furthest opening FIRST: a tender closing tomorrow cannot be bid on, so it goes last. Closed ones are
 * left out. The view "all" has no filter and lists open ones the same way, then the closed ones, most recently closed first.
 * The "not decided no" test mirrors tenderRelevance() in relevance.ts. One round trip: the counts ride on the same statement.
 * `now` goes in as an ISO string with a cast (postgres-js rejects a JS Date in a raw template); the day count is derived from
 * it in TypeScript, never stored.
 */
export async function listTenders(
  view: TenderView = "relevant",
  now: Date = new Date(),
  limit: number = TENDER_LIST_LIMIT,
  database: Pick<typeof db, "select"> = db,
): Promise<TenderList> {
  const nowIso = now.toISOString();
  const isOpen = sql`${tender.openingAt} >= ${nowIso}::timestamptz`;
  const notDecidedNo = tenderNotDecidedNoSql;
  const found = await database
    .select({ t: tender, ownerName: bd.name, budget: budgetFactsSql, total: sql<string>`count(*) over ()`, all: sql<string>`(select count(*) from tender)` })
    .from(tender)
    .leftJoin(bd, eq(bd.id, tender.ownerBdId))
    .where(view === "relevant" ? sql`${isOpen} and ${notDecidedNo}` : undefined)
    .orderBy(
      sql`case when ${isOpen} then 0 else 1 end`,
      sql`case when ${isOpen} then ${tender.openingAt} end desc`,
      desc(tender.openingAt),
      asc(tender.processNumber),
    )
    .limit(Math.min(Math.max(1, limit), TENDER_LIST_LIMIT));
  // An empty view has no row to carry the table count, which is exactly when "see all" matters most: one extra read, only then.
  const all = found.length > 0 ? Number(found[0]!.all) : Number((await database.select({ n: sql<string>`count(*)` }).from(tender))[0]?.n ?? 0);
  return {
    rows: found.map(({ t, ownerName, budget }) => ({ ...t, ownerName, budgetCell: toBudgetCell(budget), ...tenderTiming(t.openingAt, now) })),
    total: found.length === 0 ? 0 : Number(found[0]!.total),
    all,
  };
}
