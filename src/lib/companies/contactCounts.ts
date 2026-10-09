import { and, inArray, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { companyAlias, person } from "@/db/schema";

/**
 * The `/companies` list's contacts-per-company count: ONE grouped query for
 * exactly the page's company keys (never one per row, never an unbounded
 * scan — data-builder.md rule 5/7).
 *
 * Merged-away people (`merged_into_id` set) are NOT contacts: the survivor row
 * carries the person. Every read on the company record already filters them
 * (getCompanyPeople, getCompanyPersonIds, getCompanyContactCount), and this
 * one did not, so the list disagreed with the record for 261 companies
 * (Banco Galicia 76 vs 70, Brubank 17 vs 12, Flux IT 40 vs 35, Jampp 20 vs
 * 16, Naranja X 73 vs 70 — measured read-only against production
 * 2026-10-09; 328 merged-away rows still carry a company_key). Keep the
 * filter in this one builder so the list cannot drift from the record again.
 *
 * Built here, taking the database handle as a parameter, so the rendered SQL
 * is unit-testable without DATABASE_URL (the test passes a `QueryBuilder`;
 * the list passes `db`). `import type` keeps the real client out of the
 * module graph.
 */
export function companyContactCountsQuery(database: Pick<typeof db, "select">, keys: string[]) {
  return database
    .select({ companyKey: person.companyKey, count: sql<number>`count(*)::int` })
    .from(person)
    .where(and(inArray(person.companyKey, keys), isNull(person.mergedIntoId)))
    .groupBy(person.companyKey);
}

/**
 * "Who is a contact of this ONE company" for the three record reads
 * (getCompanyPeople, getCompanyPersonIds, getCompanyContactCount): not
 * merged away, and `company_key` is the company's own key OR any
 * `company_alias` key pointing at it (see aliasResolution.ts for why aliases
 * count; latent today, 0 people on an alias key).
 *
 * The alias lookup is a subquery inside the statement, not a separate read:
 * these reads each run on every record render and a round trip is the budget
 * (PERFORMANCE.md), so resolving aliases here costs 0 extra round trips where
 * a JS-side lookup would cost 1 apiece. It is an uncorrelated `IN (select ...)`
 * rather than `company_key = $1 OR EXISTS (...)` so the planner can still use
 * `person_company_key_idx` (an OR against a subplan falls back to filtering).
 * `alias_key` is the primary key and `company_alias_company_key_idx` backs the
 * inner filter. The `::text` cast is needed because a bare bind parameter in a
 * select list has no type.
 */
export function companyContactsCondition(companyKey: string) {
  return and(
    isNull(person.mergedIntoId),
    sql`${person.companyKey} in (select ${companyKey}::text union select ${companyAlias.aliasKey} from ${companyAlias} where ${companyAlias.companyKey} = ${companyKey})`,
  );
}
