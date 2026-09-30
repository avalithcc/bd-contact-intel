/**
 * Pure audit-metadata builder for scripts/backfill-inferred-emails.ts, same
 * "capped id list + documented revert path" convention as
 * src/lib/emailVerification/hubspotImportVerifiedBackfill.ts. Every applied
 * fill started from `email IS NULL` (the candidate read's own predicate), so
 * the revert is uniform and safe: reset back to null, scoped by
 * `email_source = 'pattern_inferred'` — the ONE value this backfill (and
 * nothing else) ever writes, so a row a BD has since edited by hand
 * (email_source would have moved to `'manual'`) is never touched by a
 * revert. This is the revert's anchor in BOTH the truncated and
 * non-truncated case (see revertNote below) — the id list can only ever
 * narrow it further, never replace it, since re-deriving a truncated list
 * from a fresh dry run is impossible once `email` is no longer null.
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
    // NOTE: once applied, a row's `email` is no longer null — re-running the
    // dry run to "re-derive" a truncated id list would find ZERO of these
    // rows as candidates anymore (readCandidates only reads email IS NULL).
    // `email_source = 'pattern_inferred'` alone is what uniquely tags every
    // row this backfill (and only this backfill) ever writes, so it is the
    // correct revert anchor whether or not the id list was truncated — the
    // id list only ever NARROWS it further, for a truncated run it is
    // safely dropped rather than relied on.
    revertNote: truncated
      ? "id list truncated (this run applied more than the cap) — revert ALL of this backfill's rows with: update person set email = null, email_normalized = null, email_status = 'none', email_source = null, updated_at = now() where email_source = 'pattern_inferred' (email_source alone uniquely identifies every row this backfill wrote; do not rely on the truncated id list, and do not re-run the dry run to 're-derive' it — applied rows no longer satisfy email IS NULL)"
      : "update person set email = null, email_normalized = null, email_status = 'none', email_source = null, updated_at = now() where email_source = 'pattern_inferred' and id in (<appliedPersonIds>)",
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
