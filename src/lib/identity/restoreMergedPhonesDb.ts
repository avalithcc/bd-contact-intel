/**
 * DB glue for scripts/restore-merged-phones.ts (planner:
 * ./restoreMergedPhones.ts). Imports `db`, so it is not unit-tested; the
 * logic worth testing lives in the pure planner.
 *
 * Read: ONE round trip (merged-away rows plus the rows they point at).
 * Write: ONE transaction. One UPDATE per phone column over every planned
 * survivor (never row by row), each guarded by "column is still blank" in
 * SQL, a person_property_history row per change (actor recorded, same
 * pattern as mergeDb.ts), and ONE audit_log row carrying the exact fills so
 * the run can be reverted. A count mismatch throws and rolls everything back.
 */
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bd, person, personPropertyHistory } from "@/db/schema";
import type { PhoneField, PhoneRestoreRow, RestorePlan } from "@/lib/identity/restoreMergedPhones";

export const RESTORE_RUN_ACTION = "restore_merged_phones_run";
export const RESTORE_REVERT_ACTION = "restore_merged_phones_revert";
const MAX_ROWS = 5000;
const HISTORY_BATCH = 500;
const COLUMN: Record<PhoneField, string> = { phone: "phone", mobilePhone: "mobile_phone" };

export interface RestoreFillRecord {
  personId: string;
  field: PhoneField;
  value: string;
}

export async function readPhoneRestoreRows(): Promise<{ rows: PhoneRestoreRow[]; ownerNameById: Map<string, string> }> {
  const found = await db
    .select({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      ownerBdId: person.ownerBdId,
      phone: person.phone,
      mobilePhone: person.mobilePhone,
      mergedIntoId: person.mergedIntoId,
    })
    .from(person)
    .where(
      or(
        isNotNull(person.mergedIntoId),
        sql`${person.id} in (select merged_into_id from person where merged_into_id is not null)`,
      ),
    )
    .limit(MAX_ROWS + 1);
  if (found.length > MAX_ROWS) throw new Error(`Refusing to run: more than ${MAX_ROWS} merge-related rows.`);
  const owners = await db.select({ id: bd.id, name: bd.name }).from(bd);
  return {
    rows: found.map((r) => ({
      id: r.id,
      name: [r.firstName, r.lastName].filter(Boolean).join(" ") || "(no name)",
      ownerBdId: r.ownerBdId,
      phone: r.phone,
      mobilePhone: r.mobilePhone,
      mergedIntoId: r.mergedIntoId,
    })),
    ownerNameById: new Map(owners.map((o) => [o.id, o.name])),
  };
}

export async function assertActorExists(actorBdId: string): Promise<void> {
  const [row] = await db.select({ id: bd.id }).from(bd).where(eq(bd.id, actorBdId));
  if (!row) throw new Error(`Refusing to run: no bd row for --actor=${actorBdId}`);
}

function flattenFills(plan: RestorePlan): RestoreFillRecord[] {
  return plan.restorable.flatMap((r) => r.fills.map((f) => ({ personId: r.survivorId, field: f.field, value: f.value })));
}

/** Fills (only where still blank) or clears (only where still equal to the written value) one phone column for many persons in a single statement; returns the ids actually written. */
async function bulkSetColumn(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  field: PhoneField,
  items: readonly { personId: string; value: string }[],
  mode: "fill" | "clear",
  actorBdId: string,
): Promise<string[]> {
  if (items.length === 0) return [];
  const col = sql.raw(COLUMN[field]);
  const values = sql.join(items.map((i) => sql`(${i.personId}::uuid, ${i.value}::text)`), sql`, `);
  const newValue = mode === "fill" ? sql`v.val` : sql`null`;
  const guard = mode === "fill" ? sql`coalesce(btrim(p.${col}), '') = ''` : sql`p.${col} = v.val`;
  const result = await tx.execute(sql`
    update person p set ${col} = ${newValue}, updated_at = now(), updated_by_bd_id = ${actorBdId}::uuid
    from (values ${values}) as v(pid, val)
    where p.id = v.pid and ${guard}
    returning p.id::text as id`);
  return result.map((r) => String((r as { id: string }).id));
}

async function insertHistory(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  fills: readonly RestoreFillRecord[],
  direction: "fill" | "clear",
  actorBdId: string,
): Promise<void> {
  const rows = fills.map((f) => ({
    personId: f.personId,
    property: f.field,
    oldValue: direction === "fill" ? null : f.value,
    newValue: direction === "fill" ? f.value : null,
    changedByBdId: actorBdId,
    source: "merge",
  }));
  for (let i = 0; i < rows.length; i += HISTORY_BATCH) {
    await tx.insert(personPropertyHistory).values(rows.slice(i, i + HISTORY_BATCH));
  }
}

export async function executeRestore(plan: RestorePlan, actorBdId: string, runId: string): Promise<number> {
  const fills = flattenFills(plan);
  if (fills.length === 0) return 0;
  return db.transaction(async (tx) => {
    for (const field of ["phone", "mobilePhone"] as const) {
      const items = fills.filter((f) => f.field === field);
      const written = await bulkSetColumn(tx, field, items, "fill", actorBdId);
      if (written.length !== items.length) {
        throw new Error(`Aborting (rolled back): ${field} expected ${items.length} blank survivor(s) but ${written.length} were still blank.`);
      }
    }
    await insertHistory(tx, fills, "fill", actorBdId);
    await tx.insert(auditLog).values({
      actorBdId,
      action: RESTORE_RUN_ACTION,
      metadata: { runId, fills, skippedConflicts: plan.counts.conflictSurvivors, skippedInvalid: plan.counts.invalidValues },
    });
    return fills.length;
  });
}

/** Undo a run: clears each filled column only where it still holds the value the run wrote; edits made since are kept. */
export async function revertRestore(runId: string, actorBdId: string): Promise<{ reverted: number; keptBecauseChanged: number }> {
  const [run] = await db
    .select({ metadata: auditLog.metadata })
    .from(auditLog)
    .where(and(eq(auditLog.action, RESTORE_RUN_ACTION), sql`${auditLog.metadata}->>'runId' = ${runId}`));
  if (!run) throw new Error(`Refusing to revert: no ${RESTORE_RUN_ACTION} audit_log row for runId=${runId}`);
  const fills = ((run.metadata as { fills?: RestoreFillRecord[] }).fills ?? []).slice(0, MAX_ROWS);

  return db.transaction(async (tx) => {
    const cleared: RestoreFillRecord[] = [];
    for (const field of ["phone", "mobilePhone"] as const) {
      const items = fills.filter((f) => f.field === field);
      const ids = new Set(await bulkSetColumn(tx, field, items, "clear", actorBdId));
      cleared.push(...items.filter((i) => ids.has(i.personId)));
    }
    await insertHistory(tx, cleared, "clear", actorBdId);
    await tx.insert(auditLog).values({
      actorBdId,
      action: RESTORE_REVERT_ACTION,
      metadata: { runId, reverted: cleared.length, keptBecauseChanged: fills.length - cleared.length },
    });
    return { reverted: cleared.length, keptBecauseChanged: fills.length - cleared.length };
  });
}
