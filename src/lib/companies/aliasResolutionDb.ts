import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { companyAlias } from "@/db/schema";
import type { CompanyAliasRow } from "@/lib/companies/aliasResolution";

/**
 * `company_alias` rows whose `company_key` is one of the given canonical
 * keys — ONE batched read however many keys are passed (backed by
 * `company_alias_company_key_idx`), never a per-company lookup. Empty input
 * short-circuits to no query. Feed the result to `buildCompanyMatchKeys`.
 */
export async function getCompanyAliasRows(companyKeys: string[]): Promise<CompanyAliasRow[]> {
  if (!companyKeys.length) return [];
  return db
    .select({ aliasKey: companyAlias.aliasKey, companyKey: companyAlias.companyKey })
    .from(companyAlias)
    .where(inArray(companyAlias.companyKey, companyKeys));
}
