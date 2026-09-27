/**
 * Pure mappers for the `/companies` list rebuild (mockups/companies.html).
 * No DB import — kept importable and unit-testable without a live
 * DATABASE_URL, same convention as src/lib/contacts/companyLogo.ts.
 */

const EMPTY_VALUE = "—";

/**
 * Etapa badge tone (companies.html:67 — `badge-info`/`badge-warn`/
 * `badge-success`/`badge-outline`/`badge-neutral`), same mapping the flat
 * pre-reskin page did with inline hex styles
 * (src/app/(app)/companies/[key]/page.tsx `stageColor`, now ported onto the
 * design-system's global badge classes instead of inline color values —
 * "Colors only through design tokens", ui-builder.md).
 */
export function stageBadgeClass(stage: string | null): string {
  switch (stage) {
    case "qualified":
      return "badge badge-info";
    case "proposal_sent":
      return "badge badge-warn";
    case "won":
      return "badge badge-success";
    case "lost":
      return "badge badge-outline";
    case "prospect":
    default:
      return "badge badge-neutral";
  }
}

/**
 * Vacantes column (companies.html:68 — "38 vacantes de IT" or "—").
 * `null` means "no open IT postings", so the caller renders the mockup's
 * em-dash cell instead of "0 vacantes de IT".
 */
export function vacantesLabel(openItCount: number | null | undefined): string | null {
  if (!openItCount) return null;
  return `${openItCount} vacante${openItCount === 1 ? "" : "s"} de IT`;
}

/**
 * D1 (owner-approved 2026-09-26): `company.industry`/`owner_bd_id`/`city`/
 * `country` are being added by a parallel data branch
 * (feat/company-fields-01…, forked from the same base commit as this one).
 * This is the seam these mappers read: optional fields, "—" when absent.
 * Once that branch merges and the list/record queries start selecting the
 * real columns, no mapper change is needed here — only the query call site.
 */
export interface PendingD1Fields {
  industry?: string | null;
  ownerName?: string | null;
  city?: string | null;
  country?: string | null;
}

export function industryLabel(row: PendingD1Fields): string {
  return row.industry ?? EMPTY_VALUE;
}

export function ownerLabel(row: PendingD1Fields): string {
  return row.ownerName ?? EMPTY_VALUE;
}

export function locationLabel(row: PendingD1Fields): string {
  const parts = [row.city, row.country].filter((v): v is string => Boolean(v && v.trim()));
  return parts.length ? parts.join(", ") : EMPTY_VALUE;
}
