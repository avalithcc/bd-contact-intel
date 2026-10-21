import { and, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { company, companyAlias, person } from "@/db/schema";
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

/**
 * The canonical `company.company_key` whose record page shows this person, or
 * null. `getCompanyByKey` matches that key exactly with no alias step, so the
 * record page exists only at the canonical key: revalidating the person's raw
 * `company_key` is not enough when it is an alias.
 *
 * ONE statement, ONE round trip (PERFORMANCE.md): person -> key -> canonical.
 * Mirrors the KEY rule of `companyContactsCondition` (contactCounts.ts) so the
 * page that gets revalidated is the page whose timeline includes this person. It
 * deliberately does NOT repeat that predicate's `merged_into_id` filter: a
 * merged-away person is absent from the page's person set anyway, so the only
 * effect would be one unnecessary revalidation, never a missed one.
 * A key that is
 * itself a live company resolves to itself even when a `company_alias` row also
 * names it (aliasRule.ts); otherwise a real alias resolves to its company;
 * otherwise null. Both lookups are primary-key probes. `database` defaults to
 * the app client; tests/db passes a transaction so it can roll back.
 */
export async function getCanonicalCompanyKeyForPerson(
  personId: string,
  database: Pick<typeof db, "execute"> = db,
): Promise<string | null> {
  const rows = await database.execute<{ pcc_company_key: string | null }>(sql`
    select coalesce(
      (select ${company.companyKey} from ${company} where ${company.companyKey} = ${person}.company_key),
      (select ${companyAlias.companyKey} from ${companyAlias}
        where ${companyAlias.aliasKey} = ${person}.company_key and ${aliasKeyIsNotLiveCompany()})
    ) as pcc_company_key
    from ${person}
    where ${person}.id = ${personId}::uuid
  `);
  return rows[0]?.pcc_company_key ?? null;
}
