/**
 * Cohort drill-down behind "Tasa de respuesta" and the funnel's Contactado /
 * Respondió / Reunión rows (reports-kpi-drilldown). Each number on the page is
 * a count over the period's COHORT (non-merged persons created in the period,
 * optionally owner-scoped) by CURRENT status; the list behind it must be the
 * same persons. `COHORT_STATUSES` is the one mapping the list query uses and
 * the tests pin against `rpt_funnel`'s own status lists in queries.ts.
 *
 * MIN_RATE_SAMPLE (funnel.ts) only changes how the tile DISPLAYS the ratio;
 * nothing here reads it, so a small sample never shrinks the list.
 */
import { parseDbTimestamp } from "@/lib/db/timestamp";
import type { FunnelCounts } from "./funnel";

export type CohortPopulation = "new" | "contacted" | "replied" | "meeting";

/**
 * Status list per population. An EMPTY list means "any status": "new" is the
 * whole cohort (the "Contactos nuevos" tile = rpt_funnel's pbc_new_total, a
 * bare count(*) over the cohort scope), so the query must add no status filter.
 */
export const COHORT_STATUSES: Record<CohortPopulation, readonly string[]> = {
  new: [],
  contacted: ["contacted", "replied", "meeting"],
  replied: ["replied", "meeting"],
  meeting: ["meeting"],
};

export function isCohortPopulation(value: unknown): value is CohortPopulation {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(COHORT_STATUSES, value);
}

/** Nuevos and Contactado have no reply columns: nobody in them has to have replied. */
export function cohortHasReplyColumns(population: CohortPopulation): boolean {
  return population !== "contacted" && population !== "new";
}

/** The funnel number the list must equal. */
export function cohortCount(funnel: FunnelCounts, population: CohortPopulation): number {
  return population === "new" ? funnel.newTotal : population === "contacted" ? funnel.contactedOrMore : population === "replied" ? funnel.repliedOrMore : funnel.meeting;
}

/** The funnel number the population is "N de ..." of (the header's denominator). */
export function cohortBase(funnel: FunnelCounts, population: CohortPopulation): number {
  return population === "new" || population === "contacted" ? funnel.newTotal : population === "replied" ? funnel.contactedOrMore : funnel.repliedOrMore;
}

export interface CohortRawRow {
  personId: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  ownerBdName: string | null;
  status: string;
  createdAt: Date | string;
  replyAt: Date | string | null;
  sequenceId: string | null;
  sequenceName: string | null;
}

export interface CohortRow {
  personId: string;
  personName: string;
  companyName: string | null;
  ownerBdName: string | null;
  status: string;
  createdAt: Date;
  /** `null` for a contact moved to Respondió by hand (no reply event). */
  replyAt: Date | null;
  /** `null` until `sequence_member.replied_at` is populated, or for a manual change. */
  sequenceId: string | null;
  sequenceName: string | null;
}

export function buildCohortDrilldownRows(rows: readonly CohortRawRow[]): CohortRow[] {
  return rows.map((r) => ({
    personId: r.personId,
    personName: [r.firstName, r.lastName].filter(Boolean).join(" ") || "—",
    companyName: r.companyName,
    ownerBdName: r.ownerBdName,
    status: r.status,
    createdAt: parseDbTimestamp(r.createdAt),
    replyAt: r.replyAt === null ? null : parseDbTimestamp(r.replyAt),
    sequenceId: r.sequenceId,
    sequenceName: r.sequenceName,
  }));
}
