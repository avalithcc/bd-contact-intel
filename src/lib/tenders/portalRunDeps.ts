import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tender, tenderPortal } from "@/db/schema";
import { fetchPortalProcess } from "@/lib/tenders/portalFetch";
import { tenderStillOpenSql } from "@/lib/tenders/openSql";
import { tenderNotDecidedNoSql } from "@/lib/tenders/relevanceSql";
import type { OpeningCorrection } from "@/lib/tenders/openingCorrection";
import { PORTAL_REFRESH_HOURS, type PortalCandidate, type PortalOutcome, type PortalRunDeps } from "@/lib/tenders/portalRun";

/**
 * The tenders worth refreshing, stalest first, in ONE round trip: still open (tenderStillOpenSql: open by the CRM or the portal
 * date, plus a grace window for a tender never given a portal date), not decided "not relevant",
 * and not fetched in the last PORTAL_REFRESH_HOURS. The left join is on the unique `tender_id`, so it cannot fan out; a tender with
 * no row (never fetched) sorts first. `count(*) over ()` is the total due before the limit, so the run can say what it left.
 */
export async function selectDueTenders(limit: number, database: Pick<typeof db, "select"> = db) {
  const rows = await database
    .select({ id: tender.id, processNumber: tender.processNumber, openingAt: tender.openingAt, total: sql<string>`count(*) over ()` })
    .from(tender)
    .leftJoin(tenderPortal, eq(tenderPortal.tenderId, tender.id))
    .where(
      sql`${tenderStillOpenSql} and ${tenderNotDecidedNoSql} and (${tenderPortal.fetchedAt} is null or ${tenderPortal.fetchedAt} < now() - make_interval(hours => ${PORTAL_REFRESH_HOURS}::int))`,
    )
    .orderBy(sql`${tenderPortal.fetchedAt} asc nulls first`, asc(tender.openingAt))
    .limit(limit);
  return { rows: rows.map((r) => ({ id: r.id, processNumber: r.processNumber, openingAt: r.openingAt })), total: rows[0] ? Number(rows[0].total) : 0 };
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

/**
 * Moves `tender.opening_at` to the portal's instant and logs an 'opening' event {from, to} in ONE statement. `from` is read
 * from the row itself, not from what the run saw earlier, and the update only matches a row that differs, so a concurrent
 * correction or an equal date writes nothing and logs nothing. No actor: it is the daily run, not a BD. True when it moved.
 * See openingCorrection.ts for the other writer of this column (the Excel import).
 */
export async function applyOpeningCorrection(candidate: PortalCandidate, correction: OpeningCorrection, database: Pick<typeof db, "execute"> = db): Promise<boolean> {
  const to = correction.to.toISOString();
  const rows = (await database.execute(sql`
    with old as (select opening_at from tender where id = ${candidate.id}::uuid),
    upd as (update tender set opening_at = ${to}::timestamptz, updated_at = now() where id = ${candidate.id}::uuid and opening_at is distinct from ${to}::timestamptz returning id),
    ev as (
      insert into tender_event (tender_id, actor_bd_id, kind, detail, created_at)
      select upd.id, null, 'opening', jsonb_build_object('from', to_jsonb(old.opening_at), 'to', ${to}::text), clock_timestamp()
      from upd, old
      returning 1
    )
    select (select count(*) from upd)::int as moved`)) as unknown as { moved: number }[];
  return (rows[0]?.moved ?? 0) > 0;
}

export const realPortalDeps: PortalRunDeps = {
  clock: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  selectDue: (limit) => selectDueTenders(limit),
  fetchOne: (processNumber) => fetchPortalProcess(processNumber),
  save: savePortalOutcome,
  applyOpening: (candidate, correction) => applyOpeningCorrection(candidate, correction),
};
