/**
 * Thin, read-only DB reader for scripts/backfill-company-account-type.ts.
 * Deliberately NOT unit-tested directly — it imports `@/db`, which throws
 * at import time without `DATABASE_URL` (see
 * src/lib/migration/catchUpQueries.ts's same-rationale header). All
 * branching logic worth testing lives in the pure
 * src/lib/accounts/accountTypeBackfill.ts this wires.
 *
 * One query for every `companyKey` the CSVs resolved to, never per row
 * (data-builder query rule: pre-aggregate before fan-out, bounded reads).
 */
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { company } from "@/db/schema";
import type { ExistingAccountCompanyRef } from "./accountTypeBackfill";

export async function readExistingCompaniesForAccountType(
  companyKeys: readonly string[],
): Promise<Map<string, ExistingAccountCompanyRef>> {
  if (companyKeys.length === 0) return new Map();
  const rows = await db
    .select({ companyKey: company.companyKey, notes: company.notes })
    .from(company)
    .where(inArray(company.companyKey, companyKeys as string[]));

  const result = new Map<string, ExistingAccountCompanyRef>();
  for (const row of rows) {
    result.set(row.companyKey, { companyKey: row.companyKey, notes: row.notes });
  }
  return result;
}
