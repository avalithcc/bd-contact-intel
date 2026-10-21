import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { company } from "@/db/schema";
import { companySearchCondition } from "@/lib/companies/searchCondition";

/**
 * The /companies view-tab badges as ONE `select ... from company` of
 * `count(*) FILTER (WHERE ...)` aggregates, replacing three statements (all,
 * mine, hiring), the first of which duplicated the list's own unfiltered
 * `count(*) from company`.
 *
 * Equivalence with `select count(*) from company where P`:
 *  - `count(*) FILTER (WHERE P)` counts exactly the rows where P is TRUE; a
 *    NULL or FALSE P is excluded in both forms, so NULLs behave identically.
 *  - An aggregate without GROUP BY always returns exactly one row, so an empty
 *    table gives 0 in each column, same as three separate counts.
 *  - No search term: P for "all" is absent, so it is a bare `count(*)`.
 *  - An empty hiring set cannot be `IN ()` (invalid SQL), and nothing can match
 *    it: the column is the literal `0`, exactly what the old code short-cut to.
 *
 * Schema-only imports (no `@/db`) so the compiled SQL is unit-testable.
 */
export function buildCompanyViewCountsSelection(
  meBdId: string,
  hiringKeys: readonly string[],
  q?: string,
): { all: SQL<number>; mine: SQL<number>; hiring: SQL<number> } {
  const searchWhere = companySearchCondition(q);
  const mineWhere = searchWhere ? and(eq(company.ownerBdId, meBdId), searchWhere) : eq(company.ownerBdId, meBdId);
  const hiringWhere = searchWhere
    ? and(inArray(company.companyKey, [...hiringKeys]), searchWhere)
    : inArray(company.companyKey, [...hiringKeys]);
  return {
    all: searchWhere ? sql<number>`count(*) filter (where ${searchWhere})::int` : sql<number>`count(*)::int`,
    mine: sql<number>`count(*) filter (where ${mineWhere})::int`,
    hiring: hiringKeys.length ? sql<number>`count(*) filter (where ${hiringWhere})::int` : sql<number>`0::int`,
  };
}
