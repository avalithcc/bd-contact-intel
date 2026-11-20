import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, tender } from "@/db/schema";
import { resolveCronActor } from "@/lib/identity/ownerBackfillGuards";
import { readAdminBdIds } from "@/lib/identity/ownerBackfillRun";
import { serviceRoleClient } from "@/lib/supabase/serviceRole";
import { TENDER_DOCUMENTS_BUCKET, tenderDocumentPath } from "@/lib/tenders/document";
import { fetchPliegoPdf } from "@/lib/tenders/pliegoFetch";
import { type PliegoCandidate, type PliegoRunDeps } from "@/lib/tenders/pliegoRun";
import { tenderNotDecidedNoSql } from "@/lib/tenders/relevanceSql";
import { addTenderDocument } from "@/lib/tenders/workspace";

/**
 * Open, relevant tenders with NO tender_document row, soonest opening first, in ONE round trip. A correlated NOT EXISTS (not a
 * join) so a tender with an upload of the owner's can never be picked, whatever else is on it. `count(*) over ()` is the total
 * before the limit, so the run can say what it left.
 */
export async function selectTendersWithoutDocument(limit: number, database: Pick<typeof db, "select"> = db) {
  const rows = await database
    .select({ id: tender.id, processNumber: tender.processNumber, total: sql<string>`count(*) over ()` })
    .from(tender)
    .where(sql`${tender.openingAt} > now() and ${tenderNotDecidedNoSql} and not exists (select 1 from tender_document d where d.tender_id = ${tender.id})`)
    .orderBy(asc(tender.openingAt), asc(tender.id))
    .limit(limit);
  return { rows: rows.map((r) => ({ id: r.id, processNumber: r.processNumber })), total: rows[0] ? Number(rows[0].total) : 0 };
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
