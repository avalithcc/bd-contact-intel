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

/** Muted second line under the contact name: the raw job title, or no line at all when absent/blank. */
export function jobTitleLine(jobTitle: string | null): string | null {
  const trimmed = jobTitle?.trim();
  return trimmed ? trimmed : null;
}

export type RoleGroupCell = { kind: "group"; label: string } | { kind: "unclassified" };

/**
 * "Grupo de rol" cell. NULL (nobody classified the person yet) and an unknown
 * key are "unclassified"; `no_position` is a real classification ("Sin cargo")
 * and renders its own label. The raw key is never shown.
 */
export function roleGroupCell(roleGroup: string | null, labels: Readonly<Record<string, string>>): RoleGroupCell {
  if (roleGroup === null || !Object.prototype.hasOwnProperty.call(labels, roleGroup)) return { kind: "unclassified" };
  return { kind: "group", label: labels[roleGroup]! };
}

export interface ContactSubline {
  title: string | null;
  /** Unclassified is shown (muted) only next to a title; on its own it carries nothing. */
  group: RoleGroupCell;
}

/**
 * Second line of the Contacto cell, identical in all four cohort dialogs:
 * `title · group`. Neither a title nor a classified group → no line at all
 * (null). `no_position` is a real group and shows without a title; a NULL or
 * unknown group shows as "unclassified" only when there is a title to sit next to.
 */
export function contactSubline(jobTitle: string | null, roleGroup: string | null, labels: Readonly<Record<string, string>>): ContactSubline | null {
  const title = jobTitleLine(jobTitle);
  const group = roleGroupCell(roleGroup, labels);
  if (title === null && group.kind === "unclassified") return null;
  return { title, group };
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
  roleGroup: string | null;
  jobTitle: string | null;
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
  /** `person.role_group`; `null` = not classified yet (distinct from `no_position`). */
  roleGroup: string | null;
  /** Raw `person.job_title` (free text). */
  jobTitle: string | null;
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
    roleGroup: r.roleGroup,
    jobTitle: r.jobTitle,
    createdAt: parseDbTimestamp(r.createdAt),
    replyAt: r.replyAt === null ? null : parseDbTimestamp(r.replyAt),
    sequenceId: r.sequenceId,
    sequenceName: r.sequenceName,
  }));
}
