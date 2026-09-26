/**
 * Thin DB glue for design D4's status cache: recompute deriveStatus() for a
 * set of persons from their real `activity` + `person_bd_connection` rows,
 * and write the result to `person.status`/`status_activity_id` in ONE
 * batched statement per chunk. Imports `db` (@/db has side effects
 * requiring DATABASE_URL), so — same convention as
 * src/lib/identity/resolveDb.ts — this file is not unit-tested directly;
 * `buildPersonStatusUpdates` (src/lib/status/deriveStatus.ts) carries the
 * tested grouping/derivation logic.
 *
 * TODO(Phase 6 — merge engine): `mergeContacts()` must call
 * `recomputePersonStatus(tx, survivorId)` after moving the merged person's
 * activities/connections onto the survivor, since a merge changes the
 * combined event set `deriveStatus()` sees for that person.
 *
 * Fresh-review fix (was: recomputeMessageSignals called recomputePersonStatus
 * once per touched person — 2 SELECT + 1 UPDATE each — inside one
 * request-path transaction): `recomputePersonStatuses` reads every person's
 * rows in one `IN (...)` query per table, per chunk, and writes every
 * person's result with one `UPDATE ... FROM (VALUES ...)` per chunk.
 * `recomputePersonStatus` (single id) is now a thin wrapper over it.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { activity, person, personBdConnection } from "@/db/schema";
import { buildPersonStatusUpdates } from "@/lib/status/deriveStatus";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Recomputes and writes `person.status`/`status_activity_id` for one person,
 * inside the caller's transaction — task 5.2's "same transaction as every
 * activity write" (createActivity, updateLeadStatus). Thin wrapper over
 * `recomputePersonStatuses` for the single-id call sites.
 */
export async function recomputePersonStatus(tx: DbTransaction, personId: string): Promise<void> {
  await recomputePersonStatuses(tx, [personId]);
}

/**
 * Batched version (fresh-review fix): recomputes and writes
 * `person.status`/`status_activity_id` for every id in `personIds`, chunked
 * so bind-param counts (2 columns x N ids per SELECT, 3 columns x N ids per
 * UPDATE VALUES) stay well under Postgres's 65,535 limit even for a large
 * message-import fan-out. Deduplicates `personIds` first — a no-op call
 * (empty list) does nothing.
 */
export async function recomputePersonStatuses(tx: DbTransaction, personIds: readonly string[]): Promise<void> {
  const uniqueIds = [...new Set(personIds)];
  if (!uniqueIds.length) return;

  for (const idsChunk of chunk(uniqueIds, WRITE_BATCH_SIZE)) {
    const [activityRows, connectionRows] = await Promise.all([
      tx
        .select({
          id: activity.id,
          type: activity.type,
          createdAt: activity.createdAt,
          metadata: activity.metadata,
          personId: activity.personId,
        })
        .from(activity)
        .where(inArray(activity.personId, idsChunk))
        .orderBy(asc(activity.createdAt)),
      tx
        .select({
          bdId: personBdConnection.bdId,
          sentCount: personBdConnection.sentCount,
          receivedCount: personBdConnection.receivedCount,
          lastMessageAt: personBdConnection.lastMessageAt,
          personId: personBdConnection.personId,
        })
        .from(personBdConnection)
        .where(inArray(personBdConnection.personId, idsChunk)),
    ]);

    // Non-null personId rows only — `activity.personId` is nullable at the
    // schema level (lead/company-scoped rows), but every row this query
    // returned matched `inArray(activity.personId, idsChunk)`, so it's
    // always set here; the filter just satisfies the type checker.
    const updates = buildPersonStatusUpdates(
      idsChunk,
      activityRows.filter((r): r is typeof r & { personId: string } => r.personId !== null),
      connectionRows,
    );

    const values = updates.map(
      (u) => sql`(${u.personId}::uuid, ${u.status}::text, ${u.statusActivityId}::uuid)`,
    );
    await tx.execute(sql`
      UPDATE person AS p
      SET status = v.status, status_activity_id = v.status_activity_id, updated_at = now()
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, status, status_activity_id)
      WHERE p.id = v.id
    `);
  }
}
