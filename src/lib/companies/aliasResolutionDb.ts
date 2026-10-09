import { and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { companyAlias } from "@/db/schema";
import { aliasKeyIsNotLiveCompany } from "@/lib/companies/aliasRule";
import type { CompanyAliasRow } from "@/lib/companies/aliasResolution";

/**
 * `company_alias` rows whose `company_key` is one of the given canonical
 * keys — ONE batched read however many keys are passed (backed by
 * `company_alias_company_key_idx`), never a per-company lookup. Empty input
 * short-circuits to no query. Only real aliases come back: an alias key that
 * is itself a live company key is excluded (aliasRule.ts). `database` defaults
 * to the app client; tests/db passes a transaction so it can roll back. Feed the result
 * to `buildCompanyMatchKeys`.
 */
export async function getCompanyAliasRows(
  companyKeys: string[],
  database: Pick<typeof db, "select"> = db,
): Promise<CompanyAliasRow[]> {
  if (!companyKeys.length) return [];
  return database
    .select({ aliasKey: companyAlias.aliasKey, companyKey: companyAlias.companyKey })
    .from(companyAlias)
    .where(and(inArray(companyAlias.companyKey, companyKeys), aliasKeyIsNotLiveCompany()));
}
