/**
 * Pure audit_log metadata builder for scripts/backfill-company-domains.ts's
 * `--execute` path (hardening requested after the orchestrator's live
 * dry-run showed 986 fills / 63 conflicts and asked for an all-or-nothing
 * transaction + audit trail before any owner-approved execute).
 *
 * `companyKeys` are business data (company names/keys are explicitly NOT
 * PII — see src/lib/hubspot/report.ts's own documented rationale), so
 * they're safe to persist here for the revert path: given an audit_log
 * row's metadata, revert with
 *   update company set domain = null where company_key in (<companyKeys>);
 * Capped so a very large run's metadata jsonb stays a reasonable size —
 * `fillsApplied` is always the TRUE count, never truncated, even when the
 * key list itself is.
 */

/** Above this many keys, the audit row keeps the count accurate but caps
 * the persisted key list (not a hard revert requirement for every run —
 * see the script header for the full-CSV re-derivation revert path when a
 * run is too large to list exhaustively). */
export const COMPANY_DOMAIN_BACKFILL_AUDIT_KEY_CAP = 500;

export interface CompanyDomainBackfillAuditMetadata {
  /** How many fills `planCompanyResolution` found (before this run started writing). */
  fillsPlanned: number;
  /** How many fills were ACTUALLY applied (rows changed) — the write-time
   * source of truth, may be less than `fillsPlanned` if a fill's domain
   * appeared since the dry-run read (`fillsSkippedRace`). */
  fillsApplied: number;
  /** Fills that were skipped at write time because the company's domain
   * was no longer empty (claimed by something else between the read and
   * this execute) — reported, never silently dropped. */
  fillsSkippedRace: number;
  /** Domain-fill candidates the claimed-domain guard
   * (domainClaimedByOtherCompany) already excluded before any write was
   * attempted — never counted in fillsApplied/fillsSkippedRace. */
  conflictsSkipped: number;
  /** The companyKey of every fill actually applied, capped at
   * COMPANY_DOMAIN_BACKFILL_AUDIT_KEY_CAP — the revert list. */
  companyKeys: string[];
  /** True when `companyKeys` was capped (fillsApplied is still accurate). */
  companyKeysTruncated: boolean;
}

export function buildCompanyDomainBackfillAuditMetadata(input: {
  fillsPlanned: number;
  appliedCompanyKeys: readonly string[];
  skippedRaceCompanyKeys: readonly string[];
  conflictsSkipped: number;
}): CompanyDomainBackfillAuditMetadata {
  const truncated = input.appliedCompanyKeys.length > COMPANY_DOMAIN_BACKFILL_AUDIT_KEY_CAP;
  return {
    fillsPlanned: input.fillsPlanned,
    fillsApplied: input.appliedCompanyKeys.length,
    fillsSkippedRace: input.skippedRaceCompanyKeys.length,
    conflictsSkipped: input.conflictsSkipped,
    companyKeys: truncated
      ? input.appliedCompanyKeys.slice(0, COMPANY_DOMAIN_BACKFILL_AUDIT_KEY_CAP)
      : [...input.appliedCompanyKeys],
    companyKeysTruncated: truncated,
  };
}
