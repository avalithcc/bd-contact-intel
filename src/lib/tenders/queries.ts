import { asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { tender, type Tender } from "@/db/schema";
import { tenderTiming, type TenderTiming } from "./timing";

/** The page shows everything the portal gave us; this bounds the read, not the screen (the live set is 5 to 17 rows). */
export const TENDER_LIST_LIMIT = 500;

export type TenderListRow = Tender & TenderTiming;

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
  const notDecidedNo = sql`coalesce(${tender.relevanceOverride}, ${tender.aiRelevant}) is distinct from false`;
  const found = await database
    .select({ t: tender, total: sql<string>`count(*) over ()`, all: sql<string>`(select count(*) from tender)` })
    .from(tender)
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
    rows: found.map(({ t }) => ({ ...t, ...tenderTiming(t.openingAt, now) })),
    total: found.length === 0 ? 0 : Number(found[0]!.total),
    all,
  };
}
