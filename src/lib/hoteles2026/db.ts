/**
 * Thin DB layer for the hotel-sheet import (scripts/import-hoteles-2026-10.ts).
 * Not unit-tested directly: it imports `@/db`, which throws without
 * DATABASE_URL (same rationale as src/lib/dff2026/db.ts). Every branch worth
 * testing lives in rows.ts / plan.ts.
 *
 * Dry run and execute both rebuild the context and plan INSIDE one
 * transaction; the dry run is `SET TRANSACTION READ ONLY`, so it cannot write
 * even by mistake. Execute takes the identity advisory lock first (as every
 * person-creating path does), writes companies then persons in batches, checks
 * postconditions, and writes ONE audit_log row, all in the same transaction.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bd, company, companyAlias, person } from "@/db/schema";
import { withIdentityLock } from "@/lib/identity/resolveDb";
import { isIdentityDualWriteEnabled } from "@/lib/identity/resolve";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";
import { isUuid } from "@/lib/uuid";
import { buildHotelPlan, prefetchKeys, type ExistingCompany, type ExistingPerson, type HotelPlan, type PlanContext } from "./plan";
import { HOTELES_SOURCE_KEY, type ParsedHotelSheet } from "./rows";

/** Mariel Meza (role bd), measured against prod by the owner; re-checked below. */
export const MARIEL_BD_ID = "b2c7ef1d-cec2-46de-8a33-13c7860bfa17";
export const HOTELES_AUDIT_ACTION = "hoteles_2026_10_import";
const CANDIDATE_CAP = 20_000;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 4 sequential reads: owner, aliases, companies, candidate persons. */
async function loadContext(tx: DbTransaction, parsed: ParsedHotelSheet): Promise<PlanContext> {
  const [owner] = await tx.select({ id: bd.id, role: bd.role }).from(bd).where(eq(bd.id, MARIEL_BD_ID)).limit(1);
  if (!owner || owner.role !== "bd") throw new Error(`bd ${MARIEL_BD_ID} not found with role 'bd' — refusing to import.`);

  const { emails, profileKeys, rawCompanyKeys } = prefetchKeys(parsed.rows);
  const aliasRows = rawCompanyKeys.length
    ? await tx.select({ aliasKey: companyAlias.aliasKey, companyKey: companyAlias.companyKey }).from(companyAlias).where(inArray(companyAlias.aliasKey, rawCompanyKeys))
    : [];
  const companyAliasByKey = new Map(aliasRows.map((r) => [r.aliasKey, r.companyKey]));
  const canonicalKeys = [...new Set(rawCompanyKeys.map((k) => companyAliasByKey.get(k) ?? k))];

  const companyRows = canonicalKeys.length
    ? await tx.select({ companyKey: company.companyKey, displayName: company.displayName, ownerBdId: company.ownerBdId }).from(company).where(inArray(company.companyKey, canonicalKeys))
    : [];
  const existingCompaniesByKey = new Map<string, ExistingCompany>(companyRows.map((r) => [r.companyKey, r]));

  const keyMatches = [
    emails.length ? inArray(person.emailNormalized, emails) : undefined,
    profileKeys.length ? inArray(person.profileKey, profileKeys) : undefined,
    canonicalKeys.length ? inArray(person.companyKey, canonicalKeys) : undefined,
  ].filter((c) => c !== undefined);
  const candidates: ExistingPerson[] = keyMatches.length
    ? await tx
        .select({ id: person.id, sourceKey: person.sourceKey, profileKey: person.profileKey, emailNormalized: person.emailNormalized, firstName: person.firstName, lastName: person.lastName, company: person.company, companyKey: person.companyKey })
        .from(person)
        .where(and(isNull(person.mergedIntoId), or(...keyMatches)))
        .limit(CANDIDATE_CAP + 1)
    : [];
  if (candidates.length > CANDIDATE_CAP) throw new Error(`More than ${CANDIDATE_CAP} candidate persons — refusing to plan against a truncated set.`);
  return { marielBdId: owner.id, candidates, companyAliasByKey, existingCompaniesByKey };
}

export async function dryRunHotelImport(parsed: ParsedHotelSheet): Promise<HotelPlan> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return buildHotelPlan(parsed, await loadContext(tx, parsed));
  });
}

export async function executeHotelImport(parsed: ParsedHotelSheet, actorBdId: string): Promise<{ plan: HotelPlan; auditLogId: string | null }> {
  if (!isIdentityDualWriteEnabled()) throw new Error("IDENTITY_DUAL_WRITE=false: refusing to create persons while the identity layer is switched off.");
  if (!isUuid(actorBdId)) throw new Error("--actor must be a bd uuid.");
  return db.transaction(async (tx) =>
    withIdentityLock(tx, async () => {
      const ctx = await loadContext(tx, parsed);
      const plan = buildHotelPlan(parsed, ctx);
      if (!plan.creates.length && !plan.companyOwnerUpdates.length) return { plan, auditLogId: null };

      // Plan-local refs must never reach a uuid column: fail before writing.
      for (const p of plan.creates) if (!isUuid(p.id ?? "")) throw new Error(`Planned person id is not a uuid: ${String(p.id)}`);

      for (const batch of chunk(plan.companiesToCreate, WRITE_BATCH_SIZE)) {
        const inserted = await tx
          .insert(company)
          .values(batch.map((c) => ({ companyKey: c.companyKey, displayName: c.displayName, country: c.country, relationshipStage: "prospect", ownerBdId: ctx.marielBdId, createdByBdId: actorBdId, updatedByBdId: actorBdId })))
          .onConflictDoNothing({ target: company.companyKey })
          .returning({ companyKey: company.companyKey });
        if (inserted.length !== batch.length) throw new Error(`Expected to create ${batch.length} companies, created ${inserted.length}: a company appeared since the plan was built.`);
      }
      if (plan.companyOwnerUpdates.length) {
        const updated = await tx
          .update(company)
          .set({ ownerBdId: ctx.marielBdId, updatedByBdId: actorBdId, updatedAt: new Date() })
          .where(and(inArray(company.companyKey, plan.companyOwnerUpdates), isNull(company.ownerBdId)))
          .returning({ companyKey: company.companyKey });
        if (updated.length !== plan.companyOwnerUpdates.length) throw new Error("A company owner changed since the plan was built.");
      }
      for (const batch of chunk(plan.creates, WRITE_BATCH_SIZE)) await tx.insert(person).values(batch.map((p) => ({ ...p, updatedByBdId: actorBdId })));

      const [{ count }] = (await tx.execute(sql`
        select count(*)::int as count from person
        where source_key = ${HOTELES_SOURCE_KEY} and owner_bd_id is distinct from ${ctx.marielBdId}::uuid
      `)) as unknown as { count: number }[];
      if (count > 0) throw new Error(`Postcondition failed: ${count} '${HOTELES_SOURCE_KEY}' person(s) are not owned by Mariel.`);

      const [audit] = await tx
        .insert(auditLog)
        .values({
          actorBdId,
          action: HOTELES_AUDIT_ACTION,
          metadata: {
            sourceKey: HOTELES_SOURCE_KEY,
            ownerBdId: ctx.marielBdId,
            createdPersonIds: plan.creates.map((p) => p.id),
            companiesCreated: plan.companiesToCreate.map((c) => c.companyKey),
            // Existing companies whose owner went from NULL to Mariel.
            companyOwnerUpdates: plan.companyOwnerUpdates,
          },
        })
        .returning({ id: auditLog.id });
      return { plan, auditLogId: audit!.id };
    }),
  );
}
