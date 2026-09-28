/**
 * Pure predicate + audit-metadata builder for the one-off correction that
 * relabels `person.email_status` from `'probable'` to `'verified'` for rows
 * whose email came from the HubSpot export (`person.email_source =
 * 'hubspot_import'`) — the owner confirmed those addresses were already
 * checked before the export, so `'probable'` mislabels them (they would be
 * wrongly excluded from a future "verified" filter, and the record page's
 * Verified badge would understate confidence a reader shouldn't have to
 * second-guess).
 *
 * Scope is `person.email_source`, NOT `person.source_key`: `email_source` is
 * the provenance of the ADDRESS (moves in lockstep with `email_status`/
 * `email_confidence` as one unit — see src/lib/hubspot/refill.ts's own
 * documented rule) while `source_key` is the provenance of the CONTACT row
 * itself and can legitimately disagree — e.g. a LinkedIn-imported person
 * whose email was later filled in from a HubSpot export row still keeps
 * `source_key = 'linkedin_import'`, or a HubSpot-imported person
 * (`source_key = 'hubspot_import'`) whose email came from a different
 * enrichment source. `email_source` is what answers "did THIS address come
 * from HubSpot", which is the question this correction is scoped to.
 *
 * `email_confidence` is deliberately left untouched (stays whatever it
 * already is — `null` for every hubspot_import row today, since
 * src/lib/hubspot/identity.ts and planner.ts never set a numeric score for
 * HubSpot-sourced emails). A `'verified'` status next to a `null` confidence
 * is not a new or contradictory combination in this data: `correos_final`/
 * `columna_correos`-sourced rows already carry `'verified'` with
 * `emailConfidence: null` (src/lib/leads/csv.ts) — the numeric 0-100 score
 * only ever comes from the Hunter.io file, which is a different provenance
 * ("verified" here means a human/HubSpot confirmed it, not that a scoring
 * algorithm produced a percentage).
 */

export const HUBSPOT_IMPORT_EMAIL_SOURCE = "hubspot_import";
export const PROBABLE_EMAIL_STATUS = "probable";
export const VERIFIED_EMAIL_STATUS = "verified";

export interface EmailStatusScopeRow {
  emailStatus: string;
  emailSource: string | null;
}

/**
 * The exact row-selection predicate this correction targets, expressed as a
 * pure function so it's testable in isolation from the DB — the script's
 * SQL `WHERE` clause (see src/lib/emailVerification/hubspotImportVerifiedQueries.ts)
 * must select exactly the rows this returns `true` for.
 */
export function isHubspotImportProbableEmail(row: EmailStatusScopeRow): boolean {
  return row.emailStatus === PROBABLE_EMAIL_STATUS && row.emailSource === HUBSPOT_IMPORT_EMAIL_SOURCE;
}

export const HUBSPOT_EMAIL_VERIFIED_BACKFILL_AUDIT_ID_CAP = 1000;

function capped(ids: readonly string[]): { ids: string[]; truncated: boolean } {
  const truncated = ids.length > HUBSPOT_EMAIL_VERIFIED_BACKFILL_AUDIT_ID_CAP;
  return {
    ids: truncated ? ids.slice(0, HUBSPOT_EMAIL_VERIFIED_BACKFILL_AUDIT_ID_CAP) : [...ids],
    truncated,
  };
}

export interface HubspotEmailVerifiedBackfillAuditMetadata {
  predicate: "email_status = 'probable' AND email_source = 'hubspot_import'";
  updatedCount: number;
  updatedPersonIds: string[];
  updatedPersonIdsTruncated: boolean;
  /** Revert path: `update person set email_status = 'probable' where id in (<updatedPersonIds>)`
   * when not truncated; when truncated, re-run this script's dry run against
   * the same predicate to re-derive the full set (the predicate alone no
   * longer identifies these rows once `email_status` has moved to
   * `'verified'`). */
  revertNote: string;
}

export function buildHubspotEmailVerifiedBackfillAuditMetadata(input: {
  updatedPersonIds: readonly string[];
}): HubspotEmailVerifiedBackfillAuditMetadata {
  const { ids, truncated } = capped(input.updatedPersonIds);
  return {
    predicate: "email_status = 'probable' AND email_source = 'hubspot_import'",
    updatedCount: input.updatedPersonIds.length,
    updatedPersonIds: ids,
    updatedPersonIdsTruncated: truncated,
    revertNote: truncated
      ? "id list truncated — re-run this script's dry run against the same DB state to re-derive the full set before reverting"
      : "update person set email_status = 'probable' where id in (<updatedPersonIds>)",
  };
}
