/**
 * Thin DB layer for scripts/apply-resolved-phones.ts; every decision lives in
 * plan.ts (unit-tested). The dry run is a READ ONLY transaction. Execute
 * re-reads and re-plans inside one transaction, re-guards every write in SQL
 * (a number a BD entered since the read is never overwritten — a conflict
 * aborts the whole run), writes one person_property_history row per number and
 * ONE audit_log row.
 *
 * History source is the extractor's own `signature_extract`: this is a human
 * finishing the job scripts/extract-signature-phones.ts deliberately left
 * open, not a separate provenance.
 */
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, person, personPropertyHistory } from "@/db/schema";
import { isValidPhoneFormat } from "@/lib/phone";
import { SIGNATURE_HISTORY_SOURCE } from "@/lib/signaturePhones/db";
import { isUuid } from "@/lib/uuid";
import { planResolvedPhones, ResolvedPhoneError, type ResolvedPhoneInput, type ResolvedPhoneWrite } from "./plan";

export const RESOLVED_PHONES_AUDIT_ACTION = "apply_resolved_phones";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function readPersons(tx: DbTransaction, ids: readonly string[]) {
  return tx
    .select({ id: person.id, phone: person.phone, mobilePhone: person.mobilePhone })
    .from(person)
    .where(sql`${inArray(person.id, [...ids])} and ${person.mergedIntoId} is null`);
}

function idsOf(inputs: readonly ResolvedPhoneInput[]): string[] {
  const ids = [...new Set(inputs.map((i) => i.personId))];
  for (const id of ids) if (!isUuid(id)) throw new ResolvedPhoneError(`"${id}" is not a person uuid.`);
  return ids;
}

export async function dryRunResolvedPhones(inputs: readonly ResolvedPhoneInput[]): Promise<ResolvedPhoneWrite[]> {
  const ids = idsOf(inputs);
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return planResolvedPhones(inputs, await readPersons(tx, ids), isValidPhoneFormat);
  });
}

export async function executeResolvedPhones(
  inputs: readonly ResolvedPhoneInput[],
  actorBdId: string,
): Promise<{ writes: ResolvedPhoneWrite[]; auditLogId: string }> {
  if (!isUuid(actorBdId)) throw new Error("--actor must be a bd uuid.");
  const ids = idsOf(inputs);

  return db.transaction(async (tx) => {
    const writes = planResolvedPhones(inputs, await readPersons(tx, ids), isValidPhoneFormat);

    for (const w of writes) {
      // Re-guarded in SQL: the column must STILL be empty, so a number entered
      // between the plan and this write is never clobbered.
      const column = w.column === "phone" ? sql`phone` : sql`mobile_phone`;
      const updated = (await tx.execute(sql`
        update person
        set ${column} = ${w.value}, updated_at = now(), updated_by_bd_id = ${actorBdId}::uuid
        where id = ${w.personId}::uuid and merged_into_id is null
          and btrim(coalesce(${column}, '')) = ''
        returning id::text as id
      `)) as unknown as { id: string }[];
      if (updated.length !== 1) {
        throw new Error(`Person ${w.personId} no longer has an empty ${w.column}: aborting the whole run, nothing is written.`);
      }
    }

    await tx.insert(personPropertyHistory).values(
      writes.map((w) => ({
        personId: w.personId,
        property: w.column,
        oldValue: null,
        newValue: w.value,
        changedByBdId: actorBdId,
        source: SIGNATURE_HISTORY_SOURCE,
      })),
    );

    const [audit] = await tx
      .insert(auditLog)
      .values({
        actorBdId,
        action: RESOLVED_PHONES_AUDIT_ACTION,
        // Revert: set each column back to NULL where it still equals the value
        // listed here, then delete the matching signature_extract history rows.
        metadata: { resolved: writes.map((w) => ({ personId: w.personId, column: w.column })), count: writes.length },
      })
      .returning({ id: auditLog.id });

    return { writes, auditLogId: audit!.id };
  });
}
