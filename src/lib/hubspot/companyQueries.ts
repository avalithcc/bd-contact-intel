/**
 * Thin, read-only DB reader for existing companies, feeding
 * src/lib/hubspot/companies.ts#planCompanyResolution. Deliberately NOT
 * unit-tested directly — it imports `@/db`, which throws at import time
 * without `DATABASE_URL` (see src/lib/migration/catchUpQueries.ts's
 * same-rationale header). All branching logic worth testing lives in the
 * pure `companies.ts` module this wires.
 *
 * Migration 0015 (`company.domain`) is deliberately NOT applied to prod as
 * part of this change (task 2.1 is an explicit owner gate). Postgres
 * error code 42703 (undefined_column) means the reader ran against a
 * database where 0015 hasn't been applied yet — it falls back to a
 * `domain`-less read rather than crashing, so the rest of the import
 * pipeline can still be exercised (name-matching only) before the owner
 * applies the migration.
 */
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { company } from "@/db/schema";
import type { ExistingCompanyRef } from "./companies";
import type { ExistingCompanyFieldsRow } from "./companyFieldsBackfill";

function isUndefinedColumnError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42703";
}

export async function readExistingCompanies(): Promise<ExistingCompanyRef[]> {
  try {
    const rows = await db.execute<{ company_key: string; domain: string | null }>(
      sql`SELECT company_key, domain FROM company`,
    );
    return [...rows].map((r) => ({ companyKey: r.company_key, domain: r.domain }));
  } catch (err) {
    if (!isUndefinedColumnError(err)) throw err;
    const rows = await db.execute<{ company_key: string }>(sql`SELECT company_key FROM company`);
    return [...rows].map((r) => ({ companyKey: r.company_key, domain: null }));
  }
}

/**
 * Batched existing-state read feeding
 * src/lib/hubspot/companyFieldsBackfill.ts#planCompanyFieldsBackfill: one
 * query for every `companyKey` planCompanyResolution matched, never per
 * row (bounded — see data-builder query rules). Requires migration 0017
 * (industry/owner_bd_id/city/country columns) to already be applied.
 */
export async function readExistingCompanyFields(
  companyKeys: readonly string[],
): Promise<Map<string, ExistingCompanyFieldsRow>> {
  if (companyKeys.length === 0) return new Map();
  const rows = await db
    .select({
      companyKey: company.companyKey,
      industry: company.industry,
      city: company.city,
      country: company.country,
      ownerBdId: company.ownerBdId,
    })
    .from(company)
    .where(inArray(company.companyKey, companyKeys as string[]));

  const result = new Map<string, ExistingCompanyFieldsRow>();
  for (const row of rows) {
    result.set(row.companyKey, {
      industry: row.industry,
      city: row.city,
      country: row.country,
      ownerBdId: row.ownerBdId,
    });
  }
  return result;
}
