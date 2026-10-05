/**
 * Thin DB layer for scripts/import-contactos-comerciales-2026-10.ts. Not
 * unit-tested directly (importing `@/db` throws without DATABASE_URL); every
 * branch worth testing lives in parse.ts / plan.ts.
 *
 * Dry run and execute both rebuild the context and plan INSIDE one
 * transaction; the dry run is `SET TRANSACTION READ ONLY`. Execute takes the
 * identity advisory lock first, writes persons, phone fills and history in
 * batches, checks postconditions, and writes ONE audit_log row in the same
 * transaction. Three reads: owner, aliases, persons by email (one IN list).
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bd, companyAlias, person, personPropertyHistory } from "@/db/schema";
import { isIdentityDualWriteEnabled } from "@/lib/identity/resolve";
import { withIdentityLock } from "@/lib/identity/resolveDb";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";
import { isUuid } from "@/lib/uuid";
import type { ComercialRow } from "./parse";
import { buildComercialPlan, CONTACTOS_SOURCE_KEY, prefetchKeys, type ComercialPlan, type PlanContext } from "./plan";

/** Mariel Meza (role bd), measured against prod by the owner; re-checked below. */
export const MARIEL_BD_ID = "b2c7ef1d-cec2-46de-8a33-13c7860bfa17";
export const CONTACTOS_AUDIT_ACTION = "import_contactos_comerciales_2026_10";
const CANDIDATE_CAP = 5_000;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function loadContext(tx: DbTransaction, rows: readonly ComercialRow[]): Promise<PlanContext> {
  const [owner] = await tx.select({ id: bd.id, role: bd.role }).from(bd).where(eq(bd.id, MARIEL_BD_ID)).limit(1);
  if (!owner || owner.role !== "bd") throw new Error(`bd ${MARIEL_BD_ID} not found with role 'bd': refusing to import.`);

  const { emails, rawCompanyKeys } = prefetchKeys(rows);
  const aliasRows = rawCompanyKeys.length
    ? await tx.select({ aliasKey: companyAlias.aliasKey, companyKey: companyAlias.companyKey }).from(companyAlias).where(inArray(companyAlias.aliasKey, rawCompanyKeys))
    : [];
  const existing = emails.length
    ? await tx
        .select({ id: person.id, emailNormalized: person.emailNormalized, phone: person.phone, mobilePhone: person.mobilePhone })
        .from(person)
        .where(and(isNull(person.mergedIntoId), inArray(person.emailNormalized, emails)))
        .limit(CANDIDATE_CAP + 1)
    : [];
  if (existing.length > CANDIDATE_CAP) throw new Error(`More than ${CANDIDATE_CAP} candidate persons: refusing to plan against a truncated set.`);
  return {
    ownerBdId: owner.id,
    existing: existing.map((p) => ({ ...p, emailNormalized: p.emailNormalized! })),
    companyAliasByKey: new Map(aliasRows.map((a) => [a.aliasKey, a.companyKey])),
  };
}

export async function dryRunComerciales(rows: readonly ComercialRow[]): Promise<ComercialPlan> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return buildComercialPlan(rows, await loadContext(tx, rows));
  });
}

export async function executeComerciales(rows: readonly ComercialRow[], actorBdId: string): Promise<{ plan: ComercialPlan; auditLogId: string | null }> {
  if (!isIdentityDualWriteEnabled()) throw new Error("IDENTITY_DUAL_WRITE=false: refusing to create persons while the identity layer is switched off.");
  if (!isUuid(actorBdId)) throw new Error("--actor must be a bd uuid.");
  return db.transaction(async (tx) =>
    withIdentityLock(tx, async () => {
      const ctx = await loadContext(tx, rows);
      const plan = buildComercialPlan(rows, ctx);
      if (!plan.creates.length && !plan.fills.length) return { plan, auditLogId: null };

      // Plan-local refs must never reach a uuid column: fail before writing.
      for (const p of plan.creates) if (!isUuid(p.id ?? "")) throw new Error(`Planned person id is not a uuid: ${String(p.id)}`);
      for (const f of plan.fills) if (!isUuid(f.personId)) throw new Error(`Planned fill target is not a uuid: ${f.personId}`);

      for (const batch of chunk(plan.creates, WRITE_BATCH_SIZE)) await tx.insert(person).values(batch.map((p) => ({ ...p, updatedByBdId: actorBdId })));

      // Fill-empty, guarded again in SQL so a number added since the read is never overwritten.
      for (const batch of chunk(plan.fills, WRITE_BATCH_SIZE)) {
        const values = batch.map((f) => sql`(${f.personId}::uuid, ${f.phone}::text, ${f.mobilePhone}::text)`);
        const updated = (await tx.execute(sql`
          update person as p
          set phone = v.phone, mobile_phone = v.mobile_phone, updated_at = now(), updated_by_bd_id = ${actorBdId}::uuid
          from (values ${sql.join(values, sql`, `)}) as v(id, phone, mobile_phone)
          where p.id = v.id and p.merged_into_id is null
            and btrim(coalesce(p.phone, '')) = '' and btrim(coalesce(p.mobile_phone, '')) = ''
          returning p.id::text as id
        `)) as unknown as { id: string }[];
        if (updated.length !== batch.length) throw new Error(`Expected to fill ${batch.length} contacts, filled ${updated.length}: a phone appeared since the plan was built.`);
      }
      for (const batch of chunk(plan.historyRows, WRITE_BATCH_SIZE)) await tx.insert(personPropertyHistory).values(batch);

      const [{ bad }] = (await tx.execute(sql`
        select (
          (select count(*) from person where source_key = ${CONTACTOS_SOURCE_KEY} and owner_bd_id is distinct from ${ctx.ownerBdId}::uuid)
          + (select count(*) from (select 1 from person where merged_into_id is null and source_key = ${CONTACTOS_SOURCE_KEY}
               group by email_normalized having count(*) > 1) d)
        )::int as bad
      `)) as unknown as { bad: number }[];
      if (bad > 0) throw new Error(`Postcondition failed: ${bad} wrong owner(s) or duplicated email(s).`);

      const [audit] = await tx
        .insert(auditLog)
        .values({
          actorBdId,
          action: CONTACTOS_AUDIT_ACTION,
          metadata: {
            sourceKey: CONTACTOS_SOURCE_KEY,
            ownerBdId: ctx.ownerBdId,
            report: plan.report,
            createdPersonIds: plan.creates.map((p) => p.id),
            // Revert: set phone/mobile_phone back to NULL for these ids (they were empty).
            filledPersonIds: plan.fills.map((f) => f.personId),
          },
        })
        .returning({ id: auditLog.id });
      return { plan, auditLogId: audit!.id };
    }),
  );
}
