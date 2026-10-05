/**
 * The ONE read + write path of the owner backfill, shared by
 * scripts/backfill-owner-last-worked.ts and the nightly cron
 * (src/app/api/owners/recompute/route.ts) so the two can never drift. Takes
 * `database` as a parameter (type-only `@/db` import) so the script keeps its
 * own client. Not unit-tested directly (needs a DB); the pure rules live in
 * ownerRule.ts, ownerBackfillPlan.ts and ownerBackfillGuards.ts.
 */
import { eq, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { auditLog, bd, person, personBdConnection, personPropertyHistory } from "@/db/schema";
import { buildOwnerBackfillAuditMetadata, type OwnerBackfillTrigger } from "@/lib/identity/ownerBackfillGuards";
import { planOwnerBackfill, type OwnerBackfillPlan, type OwnerChange } from "@/lib/identity/ownerBackfillPlan";
import { OWNER_BACKFILL_SOURCE, OWNER_HISTORY_PROPERTY } from "@/lib/identity/ownerRule";
import { readImportOwnerPersonIds, readManualOwnerPersonIds, readOwnerTouches } from "@/lib/identity/ownerRuleDb";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";

export const OWNER_BACKFILL_AUDIT_ACTION = "backfill_owner_last_worked";

type Database = typeof db;

/** Set-based reads (no per-row queries) + the pure planner. */
export async function loadOwnerBackfill(database: Database): Promise<{
  livePersons: number;
  plan: OwnerBackfillPlan;
  importOwnerPersonIds: Set<string>;
}> {
  const [persons, connections, touches, manualPersonIds, importOwnerPersonIds] = await Promise.all([
    database.select({ id: person.id, ownerBdId: person.ownerBdId }).from(person).where(isNull(person.mergedIntoId)),
    database
      .select({
        personId: personBdConnection.personId,
        bdId: personBdConnection.bdId,
        connectedOn: personBdConnection.connectedOn,
        lastMessageAt: personBdConnection.lastMessageAt,
      })
      .from(personBdConnection),
    readOwnerTouches(database),
    readManualOwnerPersonIds(database),
    readImportOwnerPersonIds(database),
  ]);
  return { livePersons: persons.length, plan: planOwnerBackfill({ persons, connections, touches, manualPersonIds }), importOwnerPersonIds };
}

/** Ids of every `bd` row with role 'admin' (the cron resolves its actor from this). */
export async function readAdminBdIds(database: Database): Promise<string[]> {
  const rows = await database.select({ id: bd.id }).from(bd).where(eq(bd.role, "admin"));
  return rows.map((r) => r.id);
}

export async function bdExists(database: Database, bdId: string): Promise<boolean> {
  const [row] = await database.select({ id: bd.id }).from(bd).where(eq(bd.id, bdId)).limit(1);
  return !!row;
}

/**
 * Applies a plan in ONE transaction: owner updates (guarded on the owner the
 * plan read, so a concurrent reassignment is left alone), one history row per
 * change with source `owner_backfill` (never `edit`, which would make the
 * owner sticky) and ONE audit_log row carrying `trigger`.
 */
export async function applyOwnerBackfill(
  database: Database,
  plan: OwnerBackfillPlan,
  actorBdId: string,
  trigger: OwnerBackfillTrigger,
): Promise<{ applied: number }> {
  return database.transaction(async (tx) => {
    const appliedChanges: OwnerChange[] = [];
    for (const batch of chunk(plan.changes, WRITE_BATCH_SIZE)) {
      const values = batch.map((c) => sql`(${c.personId}::uuid, ${c.fromBdId}::uuid, ${c.toBdId}::uuid)`);
      const updated = (await tx.execute(sql`
        UPDATE person AS p SET owner_bd_id = v.new_owner
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, old_owner, new_owner)
        WHERE p.id = v.id AND p.owner_bd_id IS NOT DISTINCT FROM v.old_owner
        RETURNING p.id::text AS id
      `)) as unknown as { id: string }[];
      const updatedIds = new Set(updated.map((r) => r.id));
      const done = batch.filter((c) => updatedIds.has(c.personId));
      if (done.length) {
        await tx.insert(personPropertyHistory).values(
          done.map((c) => ({
            personId: c.personId,
            property: OWNER_HISTORY_PROPERTY,
            oldValue: c.fromBdId,
            newValue: c.toBdId,
            changedByBdId: actorBdId,
            source: OWNER_BACKFILL_SOURCE,
          })),
        );
      }
      appliedChanges.push(...done);
    }
    await tx.insert(auditLog).values({
      actorBdId,
      action: OWNER_BACKFILL_AUDIT_ACTION,
      metadata: buildOwnerBackfillAuditMetadata(plan, appliedChanges, trigger, OWNER_BACKFILL_SOURCE),
    });
    return { applied: appliedChanges.length };
  });
}
