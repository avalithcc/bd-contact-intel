import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { activity, company, person } from "@/db/schema";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";

/**
 * The `/companies` "Última actividad" signal: the latest effective activity
 * time that reaches a company EITHER directly (`activity.company_key`) OR
 * through one of its contacts (`activity.person_id` -> `person.company_key`).
 * Measured 2026-10-03 against production: 340 companies have direct activity,
 * 1,386 have any once contacts count (351 of 4,290 activity rows carry a
 * company_key; most activity is logged against a person).
 *
 * Because the list now ORDERS by this value it must exist before the page's
 * `LIMIT`, so it cannot be the post-pagination batch lookup it used to be.
 * It is two CTEs, each grouped to ONE row per company key BEFORE the page
 * query joins them to `company` — the join is 1:1 on a unique key, so it
 * can never multiply rows, change the `count(*)` total, or need a de-dup.
 * `greatest()` ignores a NULL side, so a company with only one kind of
 * activity still gets a value; it is NULL only when both are absent.
 *
 * Why scanning all of `activity` is acceptable: it is 4,290 rows (measured
 * 2026-10-03), `activity_company_idx` / `activity_person_idx` back both
 * branches, and the person join is on the primary key. Re-measure before
 * reusing this pattern on a table that is not this small.
 *
 * Aliases are `pbc_`-prefixed: drizzle references CTE columns unqualified, and
 * `company` (joined alongside) has its own `company_key`.
 *
 * Built with `QueryBuilder` (no `db` import) so the rendered SQL is
 * unit-testable without DATABASE_URL, same as the other pure helpers here.
 */
export function companyLastActivity() {
  const qb = new QueryBuilder();

  const direct = qb.$with("pbc_direct").as(
    qb
      .select({
        companyKey: sql<string>`${activity.companyKey}`.as("pbc_direct_company_key"),
        at: sql<Date | string | null>`max(${effectiveActivityAtSql()})`.as("pbc_direct_at"),
      })
      .from(activity)
      .where(isNotNull(activity.companyKey))
      .groupBy(activity.companyKey),
  );

  const viaContact = qb.$with("pbc_via_contact").as(
    qb
      .select({
        companyKey: sql<string>`${person.companyKey}`.as("pbc_via_contact_company_key"),
        at: sql<Date | string | null>`max(${effectiveActivityAtSql()})`.as("pbc_via_contact_at"),
      })
      .from(activity)
      .innerJoin(person, eq(activity.personId, person.id))
      .where(isNotNull(person.companyKey))
      .groupBy(person.companyKey),
  );

  return {
    direct,
    viaContact,
    joinDirect: eq(direct.companyKey, company.companyKey),
    joinViaContact: eq(viaContact.companyKey, company.companyKey),
    // Raw computed timestamptz: postgres-js hands it back as a possibly
    // offset-less string, not a Date. Callers MUST pass it through
    // `parseDbTimestamp` (src/lib/db/timestamp.ts), never `new Date(...)`.
    lastActivityAt: sql<Date | string | null>`greatest(${direct.at}, ${viaContact.at})`,
  };
}

/**
 * Most recent activity first, companies with none last. `display_name` and
 * then `company_key` (the primary key) make the order total, so pagination
 * never drops or repeats a row across pages when many share a null or an
 * identical timestamp (launch-readiness finding F4; same discipline as
 * followUp/candidateQuery.ts).
 */
export function companyListOrderBy(lastActivityAt: ReturnType<typeof companyLastActivity>["lastActivityAt"]) {
  return [sql`${lastActivityAt} desc nulls last`, asc(company.displayName), asc(company.companyKey)];
}
