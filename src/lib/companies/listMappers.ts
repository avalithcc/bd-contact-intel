/**
 * Pure mappers for the `/companies` list rebuild (mockups/companies.html).
 * No DB import — kept importable and unit-testable without a live
 * DATABASE_URL, same convention as src/lib/contacts/companyLogo.ts.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";

const EMPTY_VALUE = "—";

export type StageLabels = Pick<
  Dictionary["companyList"],
  "stageProspect" | "stageQualified" | "stageProposalSent" | "stageWon" | "stageLost"
>;

/**
 * Maps a raw `relationship_stage` value (e.g. "qualified") to its localized
 * label (e.g. "Calificada") — extracted from a closure the Company record
 * page (`page.tsx`) used to define inline (fix/company-timeline-filter-no-
 * reload): the same mapping is now also needed server-side inside
 * `getCompanyTimelineFilterEntriesAction` (companies/actions.ts) to format a
 * scoped-fetch page's stage-change rows, so it had to stop being a
 * page-local closure.
 */
export function stageLabelOf(stage: string, l: StageLabels): string {
  switch (stage) {
    case "prospect":
      return l.stageProspect;
    case "qualified":
      return l.stageQualified;
    case "proposal_sent":
      return l.stageProposalSent;
    case "won":
      return l.stageWon;
    case "lost":
      return l.stageLost;
    default:
      return stage;
  }
}

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
 * D1 (owner-approved 2026-09-26): resolved in mockup-port c05.
 * `company.industry`/`owner_bd_id`/`city`/`country` landed via
 * `feat/company-fields-03-require-headers` (migration 0017, backfilled in
 * prod) and are now selected for real by `getCompanyListPage`/
 * `getCompanyByKey`. These mappers were built as the read seam before that
 * merge (optional fields, "—" when absent) and still fill that role for a
 * company that genuinely has no value for one of these fields (e.g. no
 * owner assigned yet) — kept as-is, no signature change needed now that the
 * query call sites pass real values instead of always-null placeholders.
 */
export interface CompanyIdentityFields {
  industry?: string | null;
  ownerName?: string | null;
  city?: string | null;
  country?: string | null;
}

export function industryLabel(row: CompanyIdentityFields): string {
  return row.industry ?? EMPTY_VALUE;
}

export function ownerLabel(row: CompanyIdentityFields): string {
  return row.ownerName ?? EMPTY_VALUE;
}

export function locationLabel(row: CompanyIdentityFields): string {
  const parts = [row.city, row.country].filter((v): v is string => Boolean(v && v.trim()));
  return parts.length ? parts.join(", ") : EMPTY_VALUE;
}

export type AccountTypeLabels = Pick<
  Dictionary["companyRecord"],
  "accountTypePartner" | "accountTypeClient" | "accountTypeStrategicOrg"
>;

/**
 * `company.account_type` (curated import — 30 partner / 2 client / rest
 * null in prod as of this writing) -> its Spanish label for the record
 * page's "Tipo de cuenta" row (CompanyAboutPane.tsx). `null` falls back to
 * the caller's em-dash, same convention as `industryLabel`; an unrecognized
 * value is returned as-is (same graceful-degradation choice as
 * `stageLabelOf`) instead of silently hiding data if the enum grows.
 */
export function accountTypeLabel(accountType: string | null, l: AccountTypeLabels): string {
  switch (accountType) {
    case "partner":
      return l.accountTypePartner;
    case "client":
      return l.accountTypeClient;
    case "strategic_org":
      return l.accountTypeStrategicOrg;
    default:
      return accountType ?? EMPTY_VALUE;
  }
}
