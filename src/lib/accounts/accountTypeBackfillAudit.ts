/**
 * Pure audit_log metadata builder for
 * scripts/backfill-company-account-type.ts's `--execute` path, mirroring
 * src/lib/hubspot/companyDomainBackfillAudit.ts's shape (one `audit_log`
 * row per run, in the same transaction as the writes).
 *
 * `companyKeys` are business data (company names/keys are explicitly NOT
 * PII — see src/lib/hubspot/report.ts's own documented rationale), so
 * they're safe to persist here for the revert path:
 *   -- undo created companies (only if nothing else has touched them since):
 *   delete from company where company_key in (<createdCompanyKeys>);
 *   -- undo account_type on companies that already existed:
 *   update company set account_type = null where company_key in (<accountTypeUpdatedCompanyKeys>);
 *   -- undo notes fills:
 *   update company set notes = null where company_key in (<notesFilledCompanyKeys>);
 *
 * `accountTypeOverridesApplied` records every owner override this run
 * actually applied (see src/lib/accounts/accountTypeBackfill.ts's
 * `ACCOUNT_TYPE_OVERRIDES`) — so the stored history says a value came from
 * a human decision, not from the (disagreeing) source CSVs. Never capped:
 * this list is bounded by how many overrides are declared in source code,
 * not by CSV size.
 */

export const ACCOUNT_TYPE_BACKFILL_AUDIT_KEY_CAP = 1000;

function capped(keys: readonly string[]): { keys: string[]; truncated: boolean } {
  const truncated = keys.length > ACCOUNT_TYPE_BACKFILL_AUDIT_KEY_CAP;
  return { keys: truncated ? keys.slice(0, ACCOUNT_TYPE_BACKFILL_AUDIT_KEY_CAP) : [...keys], truncated };
}

/** Mirrors src/lib/accounts/accountTypeBackfill.ts#AppliedAccountTypeOverride
 * — duplicated here (rather than imported) so this module stays
 * dependency-free and trivially testable; both shapes are kept in sync by
 * the script that builds this metadata. */
export interface AccountTypeOverrideAuditEntry {
  displayName: string;
  companyKey: string;
  previousAccountType: string;
  accountType: string;
  reason: string;
}

export interface AccountTypeBackfillAuditMetadata {
  companiesCreated: number;
  createdCompanyKeys: string[];
  createdCompanyKeysTruncated: boolean;
  accountTypeUpdated: number;
  accountTypeUpdatedCompanyKeys: string[];
  accountTypeUpdatedCompanyKeysTruncated: boolean;
  notesFilled: number;
  notesFilledCompanyKeys: string[];
  notesFilledCompanyKeysTruncated: boolean;
  notesSkippedNonEmpty: number;
  accountTypeOverridesApplied: AccountTypeOverrideAuditEntry[];
}

export function buildAccountTypeBackfillAuditMetadata(input: {
  createdCompanyKeys: readonly string[];
  accountTypeUpdatedCompanyKeys: readonly string[];
  notesFilledCompanyKeys: readonly string[];
  notesSkippedNonEmpty: number;
  overridesApplied?: readonly AccountTypeOverrideAuditEntry[];
}): AccountTypeBackfillAuditMetadata {
  const created = capped(input.createdCompanyKeys);
  const accountType = capped(input.accountTypeUpdatedCompanyKeys);
  const notes = capped(input.notesFilledCompanyKeys);
  return {
    companiesCreated: input.createdCompanyKeys.length,
    createdCompanyKeys: created.keys,
    createdCompanyKeysTruncated: created.truncated,
    accountTypeUpdated: input.accountTypeUpdatedCompanyKeys.length,
    accountTypeUpdatedCompanyKeys: accountType.keys,
    accountTypeUpdatedCompanyKeysTruncated: accountType.truncated,
    notesFilled: input.notesFilledCompanyKeys.length,
    notesFilledCompanyKeys: notes.keys,
    notesFilledCompanyKeysTruncated: notes.truncated,
    notesSkippedNonEmpty: input.notesSkippedNonEmpty,
    accountTypeOverridesApplied: input.overridesApplied ? [...input.overridesApplied] : [],
  };
}
