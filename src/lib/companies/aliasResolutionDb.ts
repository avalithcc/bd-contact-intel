import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { companyAlias } from "@/db/schema";
import type { CompanyAliasRow } from "@/lib/companies/aliasResolution";

/**
 * `company_alias` rows whose `company_key` is one of the given canonical
 * keys — one batched query regardless of how many keys are passed, never a
 * per-company lookup. Empty input short-circuits to no query. Feed the
 * result into `buildCompanyMatchKeys` (aliasResolution.ts) to get the
 * canonical-key -> match-keys map.
 */
export async function getCompanyAliasRows(companyKeys: string[]): Promise<CompanyAliasRow[]> {
  if (!companyKeys.length) return [];
  return db
    .select({ aliasKey: companyAlias.aliasKey, companyKey: companyAlias.companyKey })
    .from(companyAlias)
    .where(inArray(companyAlias.companyKey, companyKeys));
}
