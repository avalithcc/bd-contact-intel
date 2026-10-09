import { and, inArray, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { person } from "@/db/schema";

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
