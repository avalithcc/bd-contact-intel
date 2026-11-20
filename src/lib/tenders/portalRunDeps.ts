import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tender, tenderPortal } from "@/db/schema";
import { fetchPortalProcess } from "@/lib/tenders/portalFetch";
import { tenderNotDecidedNoSql } from "@/lib/tenders/relevanceSql";
import { PORTAL_REFRESH_HOURS, type PortalCandidate, type PortalOutcome, type PortalRunDeps } from "@/lib/tenders/portalRun";

/**
 * The tenders worth refreshing, stalest first, in ONE round trip: open (the opening is still ahead), not decided "not relevant",
 * and not fetched in the last PORTAL_REFRESH_HOURS. The left join is on the unique `tender_id`, so it cannot fan out; a tender with
 * no row (never fetched) sorts first. `count(*) over ()` is the total due before the limit, so the run can say what it left.
 */
export async function selectDueTenders(limit: number, database: Pick<typeof db, "select"> = db) {
  const rows = await database
    .select({ id: tender.id, processNumber: tender.processNumber, total: sql<string>`count(*) over ()` })
    .from(tender)
    .leftJoin(tenderPortal, eq(tenderPortal.tenderId, tender.id))
    .where(
      sql`${tender.openingAt} > now() and ${tenderNotDecidedNoSql} and (${tenderPortal.fetchedAt} is null or ${tenderPortal.fetchedAt} < now() - make_interval(hours => ${PORTAL_REFRESH_HOURS}::int))`,
    )
    .orderBy(sql`${tenderPortal.fetchedAt} asc nulls first`, asc(tender.openingAt))
    .limit(limit);
  return { rows: rows.map((r) => ({ id: r.id, processNumber: r.processNumber })), total: rows[0] ? Number(rows[0].total) : 0 };
}

/** Success replaces the data and clears the error. A failed or empty refresh moves ONLY fetched_at and fetch_error: the last good data stays. */
export async function savePortalOutcome(candidate: PortalCandidate, outcome: PortalOutcome, at: Date, database: Pick<typeof db, "insert"> = db): Promise<void> {
  if (outcome.kind === "ok") {
    const data = { ...outcome.fields, portalUrl: outcome.portalUrl, fetchedAt: at, fetchError: null };
    await database.insert(tenderPortal).values({ tenderId: candidate.id, ...data }).onConflictDoUpdate({ target: tenderPortal.tenderId, set: data });
    return;
  }
  const status = { fetchedAt: at, fetchError: outcome.kind === "not_found" ? "not_found" : outcome.message };
  await database.insert(tenderPortal).values({ tenderId: candidate.id, ...status }).onConflictDoUpdate({ target: tenderPortal.tenderId, set: status });
}

export const realPortalDeps: PortalRunDeps = {
  clock: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  selectDue: (limit) => selectDueTenders(limit),
  fetchOne: (processNumber) => fetchPortalProcess(processNumber),
  save: savePortalOutcome,
};
