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
 */

export const ACCOUNT_TYPE_BACKFILL_AUDIT_KEY_CAP = 1000;

function capped(keys: readonly string[]): { keys: string[]; truncated: boolean } {
  const truncated = keys.length > ACCOUNT_TYPE_BACKFILL_AUDIT_KEY_CAP;
  return { keys: truncated ? keys.slice(0, ACCOUNT_TYPE_BACKFILL_AUDIT_KEY_CAP) : [...keys], truncated };
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
}

export function buildAccountTypeBackfillAuditMetadata(input: {
  createdCompanyKeys: readonly string[];
  accountTypeUpdatedCompanyKeys: readonly string[];
  notesFilledCompanyKeys: readonly string[];
  notesSkippedNonEmpty: number;
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
  };
}
