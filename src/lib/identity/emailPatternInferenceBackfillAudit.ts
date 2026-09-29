/**
 * Pure audit-metadata builder for scripts/backfill-inferred-emails.ts, same
 * "capped id list + documented revert path" convention as
 * src/lib/emailVerification/hubspotImportVerifiedBackfill.ts. Every applied
 * fill started from `email IS NULL` (the candidate read's own predicate), so
 * the revert is uniform and safe: reset back to null, scoped by
 * `email_source = 'pattern_inferred'` so a row a BD has since edited by hand
 * (email_source would have moved to `'manual'`) is never touched by a
 * revert.
 */
export const PATTERN_INFERRED_EMAIL_SOURCE = "pattern_inferred";
export const EMAIL_PATTERN_INFERENCE_BACKFILL_ACTION = "email_pattern_inference_backfill";
export const EMAIL_PATTERN_INFERENCE_BACKFILL_AUDIT_ID_CAP = 1000;

function capped(ids: readonly string[]): { ids: string[]; truncated: boolean } {
  const truncated = ids.length > EMAIL_PATTERN_INFERENCE_BACKFILL_AUDIT_ID_CAP;
  return {
    ids: truncated ? ids.slice(0, EMAIL_PATTERN_INFERENCE_BACKFILL_AUDIT_ID_CAP) : [...ids],
    truncated,
  };
}

export interface EmailPatternInferenceBackfillAuditMetadata {
  fillsPlanned: number;
  appliedCount: number;
  appliedPersonIds: string[];
  appliedPersonIdsTruncated: boolean;
  skippedRaceCount: number;
  skippedRacePersonIds: string[];
  /** Revert path: every applied row started from `email IS NULL` and
   * `email_source = 'pattern_inferred'` scopes the revert to rows this
   * backfill (and nothing since) touched. */
  revertNote: string;
}

export function buildEmailPatternInferenceBackfillAuditMetadata(input: {
  fillsPlanned: number;
  appliedPersonIds: readonly string[];
  skippedRacePersonIds: readonly string[];
}): EmailPatternInferenceBackfillAuditMetadata {
  const { ids, truncated } = capped(input.appliedPersonIds);
  return {
    fillsPlanned: input.fillsPlanned,
    appliedCount: input.appliedPersonIds.length,
    appliedPersonIds: ids,
    appliedPersonIdsTruncated: truncated,
    skippedRaceCount: input.skippedRacePersonIds.length,
    skippedRacePersonIds: [...input.skippedRacePersonIds],
    revertNote: truncated
      ? "id list truncated — revert by id in (<appliedPersonIds>) AND email_source = 'pattern_inferred' is still safe for the untruncated set; re-run this script's dry run to re-derive the rest"
      : "update person set email = null, email_normalized = null, email_status = 'none', email_source = null, updated_at = now() where id in (<appliedPersonIds>) and email_source = 'pattern_inferred'",
  };
}

/** No-op re-run must never write an empty audit_log row (same fix as
 * nameFromEmailBackfillAudit.ts) — it would become the newest row and hide
 * the real backfill from a future revert. */
export function isEmailPatternInferenceBackfillAuditWorthRecording(input: {
  appliedPersonIds: readonly string[];
}): boolean {
  return input.appliedPersonIds.length > 0;
}
