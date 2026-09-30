/**
 * "Empresas ganadas" KPI drilldown (reports-bd-filter-drilldown fix). Pure
 * row normalizer for buildWonCompaniesDrilldownQuery's raw result — same
 * "normalize raw-SQL results" rule every other reports pure module follows
 * (queries return a `Date | string` timestamp from postgres-js; this pins
 * it to a real `Date`).
 *
 * `wonAtExact` is `false` when no `status_change` activity recording the
 * transition into 'won' exists for this company (pre-dates that write path,
 * or was backfilled without one) — the caller falls back to
 * `company.updated_at` and must render that as an approximation, never as
 * fact.
 *
 * Deliberately BD-filtered only (never period-filtered): "Empresas ganadas"
 * itself reuses the "Pipeline de empresas" CURRENT-snapshot count (decision
 * 7, pipeline.ts) — a drilldown that dropped rows outside the selected
 * period would show fewer companies than the KPI number above it, which is
 * the exact class of "the numbers don't match" bug this change fixes.
 *
 * `ownerBdId`/`ownerBdName` (prod bug fix 2026-09-30): prefer the company's
 * own owner, falling back to its most-recently-updated owned, non-merged
 * person's owner (companyBdAttribution.ts) — both real won companies in
 * prod (Almería Sports Destination, Datapar S.A.) have no company-level
 * owner, so scoping/display by `company.owner_bd_id` alone made this KPI
 * read 0 for every BD.
 */

export interface WonCompanyDrilldownRawRow {
  companyKey: string;
  displayName: string;
  ownerBdId: string | null;
  ownerBdName: string | null;
  wonAt: Date | string;
  wonAtExact: boolean;
}

export interface WonCompanyDrilldownRow {
  companyKey: string;
  displayName: string;
  ownerBdId: string | null;
  ownerBdName: string | null;
  wonAt: Date;
  wonAtExact: boolean;
}

export function buildWonCompanyDrilldownRows(rows: readonly WonCompanyDrilldownRawRow[]): WonCompanyDrilldownRow[] {
  return rows.map((r) => ({
    ...r,
    wonAt: r.wonAt instanceof Date ? r.wonAt : new Date(r.wonAt),
  }));
}
