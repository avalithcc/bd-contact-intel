/**
 * Pure audit_log metadata builder for
 * scripts/backfill-split-remaining-stuffed-names.ts's `--execute` path.
 * Mirrors src/lib/identity/stuffedNameSplitBackfillAudit.ts's shape (and the
 * same CRITICAL no-op-must-not-write-a-row fix) — kept as its own module,
 * not reused, because its `fills` are keyed by this backfill's OWN action
 * name (see stuffedNameFirstTokenSplitBackfillRevertDb.ts) for a separate,
 * independently revertible audit trail.
 */

export const FIRST_TOKEN_SPLIT_AUDIT_CAP = 5000;

export interface AppliedFirstTokenSplit {
  personId: string;
  firstName: string;
  lastName: string;
  originalFirstName: string;
  originalLastName: string | null;
  rule: "plain" | "middle_initial";
}

export interface FirstTokenSplitAuditMetadata {
  fillsPlanned: number;
  fillsApplied: number;
  /** Fills skipped at write time because the row's state (first_name and/or
   * last_name) had already changed since the dry run — reported, never
   * silently dropped. */
  fillsSkippedRace: number;
  fills: AppliedFirstTokenSplit[];
  fillsTruncated: boolean;
}

/**
 * CRITICAL fix (same as isStuffedNameSplitAuditWorthRecording): an
 * `--execute` run that applies ZERO fills must NOT write an audit_log row —
 * it would become the newest row and hide the real backfill from
 * `--revert`'s row-selection.
 */
export function isFirstTokenSplitAuditWorthRecording(input: { appliedFills: readonly unknown[] }): boolean {
  return input.appliedFills.length > 0;
}

export function buildFirstTokenSplitAuditMetadata(input: {
  fillsPlanned: number;
  appliedFills: readonly AppliedFirstTokenSplit[];
  skippedRacePersonIds: readonly string[];
}): FirstTokenSplitAuditMetadata {
  const fillsTruncated = input.appliedFills.length > FIRST_TOKEN_SPLIT_AUDIT_CAP;
  return {
    fillsPlanned: input.fillsPlanned,
    fillsApplied: input.appliedFills.length,
    fillsSkippedRace: input.skippedRacePersonIds.length,
    fills: fillsTruncated ? input.appliedFills.slice(0, FIRST_TOKEN_SPLIT_AUDIT_CAP) : [...input.appliedFills],
    fillsTruncated,
  };
}
