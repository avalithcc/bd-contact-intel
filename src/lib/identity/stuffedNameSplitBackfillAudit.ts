/**
 * Pure audit_log metadata builder for
 * scripts/backfill-split-stuffed-names.ts's `--execute` path. Mirrors
 * src/lib/identity/nameFromEmailBackfillAudit.ts's shape and the same
 * CRITICAL no-op-must-not-write-a-row fix.
 *
 * `fills` stores each applied fill's personId, the exact firstName/lastName
 * written, AND the original (pre-backfill) firstName/lastName — the revert
 * planner needs BOTH: the written values (to only revert a row still
 * unchanged since this run) and the original values (to know what to
 * restore, since the pre-backfill state here isn't uniformly NULL/NULL like
 * nameFromEmailBackfill's).
 */

export const STUFFED_NAME_SPLIT_AUDIT_CAP = 5000;

export interface AppliedStuffedNameSplit {
  personId: string;
  firstName: string;
  lastName: string;
  originalFirstName: string;
  originalLastName: string | null;
  rule: "particle" | "two_tokens" | "email_resolved" | "heuristic_4";
}

export interface StuffedNameSplitAuditMetadata {
  fillsPlanned: number;
  fillsApplied: number;
  /** Fills skipped at write time because the row's state (first_name and/or
   * last_name) had already changed since the dry run — reported, never
   * silently dropped. */
  fillsSkippedRace: number;
  fills: AppliedStuffedNameSplit[];
  fillsTruncated: boolean;
}

/**
 * CRITICAL fix (same as isNameFromEmailBackfillAuditWorthRecording): an
 * `--execute` run that applies ZERO fills must NOT write an audit_log row —
 * it would become the newest row and hide the real backfill from
 * `--revert`'s row-selection.
 */
export function isStuffedNameSplitAuditWorthRecording(input: { appliedFills: readonly unknown[] }): boolean {
  return input.appliedFills.length > 0;
}

export function buildStuffedNameSplitAuditMetadata(input: {
  fillsPlanned: number;
  appliedFills: readonly AppliedStuffedNameSplit[];
  skippedRacePersonIds: readonly string[];
}): StuffedNameSplitAuditMetadata {
  const fillsTruncated = input.appliedFills.length > STUFFED_NAME_SPLIT_AUDIT_CAP;
  return {
    fillsPlanned: input.fillsPlanned,
    fillsApplied: input.appliedFills.length,
    fillsSkippedRace: input.skippedRacePersonIds.length,
    fills: fillsTruncated ? input.appliedFills.slice(0, STUFFED_NAME_SPLIT_AUDIT_CAP) : [...input.appliedFills],
    fillsTruncated,
  };
}
