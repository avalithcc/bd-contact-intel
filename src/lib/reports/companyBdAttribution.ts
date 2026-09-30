/**
 * "Does this company count for BD X" rollup (reports-bd-filter-drilldown,
 * prod measurement 2026-09-30): scoping "Empresas ganadas"/"Pipeline de
 * empresas" by `company.owner_bd_id` ALONE made both cards read 0 for
 * every BD in production, because neither real won company
 * (Almería Sports Destination, Datapar S.A.) has an owner set on the
 * company row itself.
 *
 * A company counts for `bdId` when EITHER `company.owner_bd_id` is that BD,
 * OR any non-merged `person` at that company has `owner_bd_id` set to that
 * BD (Datapar's real case: the company itself has no owner, but its one
 * contact does). `bdId === null` ("Todos los BDs") always counts, matching
 * every other nullable BD filter in this file.
 *
 * This is the pure JS twin of `companyBelongsToBdSql()` (queries.ts) — same
 * "SQL twin pins the rule in a fast unit test" convention as
 * effectiveActivityAtSql()/resolveEffectiveActivityAt (effectiveActivityTime.ts).
 * Used by both the "Empresas ganadas" drilldown and "Pipeline de empresas"
 * (via the SAME `rpt_pipeline` CTE the KPI reuses) so the two numbers can
 * never disagree.
 */

export interface CompanyBdAttributionInput {
  companyOwnerBdId: string | null;
  /** Owner ids of every non-merged person at this company (duplicates/nulls allowed, both ignored). */
  personOwnerBdIds: readonly (string | null)[];
}

export function companyBelongsToBd(input: CompanyBdAttributionInput, bdId: string | null): boolean {
  if (bdId === null) return true;
  if (input.companyOwnerBdId === bdId) return true;
  return input.personOwnerBdIds.includes(bdId);
}
