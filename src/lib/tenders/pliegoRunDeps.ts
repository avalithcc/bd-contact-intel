import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, tender, tenderPortal } from "@/db/schema";
import { resolveCronActor } from "@/lib/identity/ownerBackfillGuards";
import { readAdminBdIds } from "@/lib/identity/ownerBackfillRun";
import { serviceRoleClient } from "@/lib/supabase/serviceRole";
import { TENDER_DOCUMENTS_BUCKET, tenderDocumentPath } from "@/lib/tenders/document";
import { fetchPliegoPdf } from "@/lib/tenders/pliegoFetch";
import { PLIEGO_ABSENT_ERRORS, PLIEGO_RETRY_ABSENT_HOURS, PLIEGO_RETRY_FAILURE_HOURS, type PliegoCandidate, type PliegoRunDeps } from "@/lib/tenders/pliegoRun";
import { tenderStillOpenSql } from "@/lib/tenders/openSql";
import { tenderNotDecidedNoSql } from "@/lib/tenders/relevanceSql";
import { addTenderDocument } from "@/lib/tenders/workspace";

/**
 * Still-open (see tenderStillOpenSql: open by the CRM or the portal date), relevant tenders with NO tender_document row, soonest opening first, in ONE round trip. A correlated NOT EXISTS (not a
 * join) so a tender with an upload of the owner's can never be picked, whatever else is on it. A tender whose last pliego attempt
 * is inside its cooldown (see PLIEGO_RETRY_*_HOURS) is "cooling": it sorts last and is dropped from the rows, but the window counts
 * still see it, so the run can say how many it skipped and why. The left join is on the unique `tender_id`, so it cannot fan out.
 * `total` is what is due (not cooling) before the limit.
 */
export async function selectTendersWithoutDocument(limit: number, database: Pick<typeof db, "select"> = db) {
  const absent = sql.join(PLIEGO_ABSENT_ERRORS.map((e) => sql`${e}`), sql`, `);
  const cooling = sql<boolean>`(${tenderPortal.pliegoCheckedAt} is not null and ${tenderPortal.pliegoError} is not null and ${tenderPortal.pliegoCheckedAt} > now() - make_interval(hours => (case when ${tenderPortal.pliegoError} in (${absent}) then ${PLIEGO_RETRY_ABSENT_HOURS}::int else ${PLIEGO_RETRY_FAILURE_HOURS}::int end)))`;
  const rows = await database
    .select({
      id: tender.id,
      processNumber: tender.processNumber,
      cooling: cooling.as("pliego_cooling"),
      due: sql<string>`count(*) filter (where not ${cooling}) over ()`,
      coolingTotal: sql<string>`count(*) filter (where ${cooling}) over ()`,
    })
    .from(tender)
    .leftJoin(tenderPortal, eq(tenderPortal.tenderId, tender.id))
    .where(sql`${tenderStillOpenSql} and ${tenderNotDecidedNoSql} and not exists (select 1 from tender_document d where d.tender_id = ${tender.id})`)
    .orderBy(asc(sql`pliego_cooling`), asc(tender.openingAt), asc(tender.id))
    .limit(limit);
  return {
    rows: rows.filter((r) => !r.cooling).map((r) => ({ id: r.id, processNumber: r.processNumber })),
    total: rows[0] ? Number(rows[0].due) : 0,
    cooling: rows[0] ? Number(rows[0].coolingTotal) : 0,
  };
}

/**
 * Stamps a pliego attempt on the tender's portal row, creating it when the portal job has not reached the tender. A row made here
 * gets `fetched_at` = epoch, so the portal refresh still sees the tender as stale (and the ficha shows nothing: no portal_url).
 */
export async function savePliegoAttempt(candidate: PliegoCandidate, error: string | null, at: Date, database: Pick<typeof db, "insert"> = db): Promise<void> {
  const stamp = { pliegoCheckedAt: at, pliegoError: error };
  await database.insert(tenderPortal).values({ tenderId: candidate.id, fetchedAt: new Date(0), ...stamp }).onConflictDoUpdate({ target: tenderPortal.tenderId, set: stamp });
}

/** The single admin's bd id and Supabase auth uid (the first folder of the storage path), or why there is none. */
async function resolveUploader(): Promise<{ ok: true; bdId: string; authUid: string } | { ok: false; reason: string }> {
  const actor = resolveCronActor(await readAdminBdIds(db));
  if (!actor.ok) return actor;
  const [row] = await db.select({ email: bd.email }).from(bd).where(eq(bd.id, actor.bdId)).limit(1);
  if (!row) return { ok: false, reason: "no_admin" };
  const found = await db.execute<{ id: string }>(sql`select id::text as id from auth.users where lower(email) = lower(${row.email}) and deleted_at is null limit 2`);
  const ids = [...found].map((r) => r.id);
  if (ids.length !== 1) return { ok: false, reason: "no_auth_user" };
  return { ok: true, bdId: actor.bdId, authUid: ids[0]! };
}

let uploader: { bdId: string; authUid: string } | null = null;

export const realPliegoDeps: PliegoRunDeps = {
  clock: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  prepare: async () => {
    const storage = serviceRoleClient();
    if (!storage) return { ok: false, reason: "storage_not_configured" };
    const who = await resolveUploader();
    if (!who.ok) return who;
    uploader = { bdId: who.bdId, authUid: who.authUid };
    return { ok: true };
  },
  selectDue: (limit) => selectTendersWithoutDocument(limit),
  record: (candidate, error, at) => savePliegoAttempt(candidate, error, at),
  fetchOne: (processNumber) => fetchPliegoPdf(processNumber),
  store: async (candidate: PliegoCandidate, file) => {
    const client = serviceRoleClient();
    if (!client || !uploader) throw new Error("not_prepared");
    const path = tenderDocumentPath(uploader.authUid, randomUUID(), file.filename);
    const bucket = client.storage.from(TENDER_DOCUMENTS_BUCKET);
    const up = await bucket.upload(path, file.bytes, { contentType: "application/pdf", upsert: false });
    if (up.error) throw new Error(`upload: ${up.error.message}`.slice(0, 200));
    try {
      const id = await addTenderDocument({ tenderId: candidate.id, storagePath: path, filename: file.filename, sizeBytes: file.bytes.length, actorBdId: uploader.bdId, onlyIfNone: true });
      if (id) return "stored";
    } catch (err) {
      await bucket.remove([path]);
      throw err;
    }
    await bucket.remove([path]);
    return "skipped";
  },
};
