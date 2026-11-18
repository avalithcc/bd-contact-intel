import { asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { tender, type Tender } from "@/db/schema";
import { tenderTiming, type TenderTiming } from "./timing";

/** The page shows everything the portal gave us; this bounds the read, not the screen (the live set is 5 to 17 rows). */
export const TENDER_LIST_LIMIT = 500;

export type TenderListRow = Tender & TenderTiming;

export interface TenderList {
  rows: TenderListRow[];
  /** Rows in the table, which can exceed `rows` only past TENDER_LIST_LIMIT. */
  total: number;
}

/**
 * Open tenders soonest-opening first, then the ones whose opening has passed (most recently closed first): a past tender is
 * marked closed, never hidden, but it must not push a live one down the screen. One round trip: the total rides on the same
 * statement as a window count. `now` goes in as an ISO string with a cast (postgres-js rejects a JS Date in a raw template);
 * the day count is derived from it in TypeScript, never stored.
 */
export async function listTenders(
  now: Date = new Date(),
  limit: number = TENDER_LIST_LIMIT,
  database: Pick<typeof db, "select"> = db,
): Promise<TenderList> {
  const nowIso = now.toISOString();
  const isOpen = sql`${tender.openingAt} >= ${nowIso}::timestamptz`;
  const found = await database
    .select({ t: tender, total: sql<string>`count(*) over ()` })
    .from(tender)
    .orderBy(
      sql`case when ${isOpen} then 0 else 1 end`,
      sql`case when ${isOpen} then ${tender.openingAt} end asc`,
      desc(tender.openingAt),
      asc(tender.processNumber),
    )
    .limit(Math.min(Math.max(1, limit), TENDER_LIST_LIMIT));
  return {
    rows: found.map(({ t }) => ({ ...t, ...tenderTiming(t.openingAt, now) })),
    total: found.length === 0 ? 0 : Number(found[0]!.total),
  };
}
