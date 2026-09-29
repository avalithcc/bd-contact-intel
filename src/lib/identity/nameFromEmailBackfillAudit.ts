/**
 * Pure audit_log metadata builder for
 * scripts/backfill-person-names-from-email.ts's `--execute` path. Mirrors
 * src/lib/hubspot/companyDomainBackfillAudit.ts's shape (fillsPlanned/
 * fillsApplied/fillsSkippedRace + a capped key list for the revert path),
 * with `personIds` (uuids) instead of `companyKeys` — uuids are not PII by
 * themselves (unlike the email/name they resolve to), so they're the right
 * thing to persist here, never the email or the derived name.
 *
 * Revert path: given an audit_log row's metadata (action =
 * 'person_name_from_email_backfill'),
 *   update person set first_name = null, last_name = null where id in (<personIds>);
 * (both fields are set back to NULL together, since this backfill only ever
 * fills a row whose first_name AND last_name were BOTH empty — see the
 * script's own precondition. If `personIdsTruncated` is true, re-derive the
 * full set by re-running this script's dry run against the SAME DB state
 * instead of relying on the capped list.)
 */

/** Above this many ids, the audit row keeps the count accurate but caps the
 * persisted id list — same convention as
 * COMPANY_DOMAIN_BACKFILL_AUDIT_KEY_CAP. */
export const NAME_FROM_EMAIL_BACKFILL_AUDIT_ID_CAP = 5000;

export interface NameFromEmailBackfillAuditMetadata {
  /** How many fills the planner found (before this run started writing). */
  fillsPlanned: number;
  /** How many fills were ACTUALLY applied (rows changed) — the write-time
   * source of truth, may be less than `fillsPlanned` if a row's name/last
   * name was no longer empty by write time (`fillsSkippedRace`). */
  fillsApplied: number;
  /** Fills skipped at write time because the person's name was no longer
   * empty (changed by something else between the read and this execute) —
   * reported, never silently dropped. */
  fillsSkippedRace: number;
  /** The person id of every fill actually applied, capped at
   * NAME_FROM_EMAIL_BACKFILL_AUDIT_ID_CAP — the revert list. */
  personIds: string[];
  /** True when `personIds` was capped (fillsApplied is still accurate). */
  personIdsTruncated: boolean;
}

export function buildNameFromEmailBackfillAuditMetadata(input: {
  fillsPlanned: number;
  appliedPersonIds: readonly string[];
  skippedRacePersonIds: readonly string[];
}): NameFromEmailBackfillAuditMetadata {
  const truncated = input.appliedPersonIds.length > NAME_FROM_EMAIL_BACKFILL_AUDIT_ID_CAP;
  return {
    fillsPlanned: input.fillsPlanned,
    fillsApplied: input.appliedPersonIds.length,
    fillsSkippedRace: input.skippedRacePersonIds.length,
    personIds: truncated
      ? input.appliedPersonIds.slice(0, NAME_FROM_EMAIL_BACKFILL_AUDIT_ID_CAP)
      : [...input.appliedPersonIds],
    personIdsTruncated: truncated,
  };
}
