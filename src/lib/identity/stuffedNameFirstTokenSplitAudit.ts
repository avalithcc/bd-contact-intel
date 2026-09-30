/**
 * Pure audit_log metadata builder for
 * scripts/backfill-split-remaining-stuffed-names.ts's `--execute` path.
 * Mirrors src/lib/identity/stuffedNameSplitBackfillAudit.ts's shape (and the
 * same CRITICAL no-op-must-not-write-a-row fix) — kept as its own module,
 * not reused, because its `fills` are keyed by this backfill's OWN action
 * name (see stuffedNameFirstTokenSplitBackfillRevertDb.ts) for a separate,
 * independently revertible audit trail.
 */
import type { FirstTokenSplitRule } from "./stuffedNameFirstTokenSplit";

export const FIRST_TOKEN_SPLIT_AUDIT_CAP = 5000;

export interface AppliedFirstTokenSplit {
  personId: string;
  /** Nullable — a manual override can explicitly NULL a field (owner ask,
   * 2026-09-30, e.g. the "Ciotta"/"Smart Gen" overrides). */
  firstName: string | null;
  lastName: string | null;
  originalFirstName: string;
  originalLastName: string | null;
  rule: FirstTokenSplitRule;
  /** Only set when this fill ALSO linked a brand-new company (the "Smart
   * Gen" override) — needed so --revert can detach the person's
   * company/companyKey and, if this run created the company, delete it
   * PROVIDED nothing else references it by revert time. */
  linkedCompany?: { companyKey: string; displayName: string; createdNewCompany: boolean };
}

export interface FirstTokenSplitAuditMetadata {
  fillsPlanned: number;
  fillsApplied: number;
  /** Fills skipped at write time because the row's state (first_name and/or
   * last_name) had already changed since the dry run — reported, never
   * silently dropped. */
  fillsSkippedRace: number;
  fills: AppliedFirstTokenSplit[];
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

/**
 * Review fix: REFUSES (throws) rather than truncate when `appliedFills`
 * exceeds the cap — silently truncating the `fills` list would write an
 * audit_log row that can no longer revert the overflow rows (the revert
 * planner only ever sees what's in the audit metadata), which is worse than
 * failing loudly. Callers must never let a single run exceed the cap — split
 * into smaller batches instead. This is a hard invariant, checked here (not
 * just in the calling script) so it holds regardless of caller.
 */
export function buildFirstTokenSplitAuditMetadata(input: {
  fillsPlanned: number;
  appliedFills: readonly AppliedFirstTokenSplit[];
  skippedRacePersonIds: readonly string[];
}): FirstTokenSplitAuditMetadata {
  if (input.appliedFills.length > FIRST_TOKEN_SPLIT_AUDIT_CAP) {
    throw new Error(
      `Refusing to write audit_log: ${input.appliedFills.length} applied fill(s) exceed the ` +
        `${FIRST_TOKEN_SPLIT_AUDIT_CAP}-row audit cap — truncating would silently break --revert for the ` +
        "overflow rows. Split this run into smaller batches instead.",
    );
  }
  return {
    fillsPlanned: input.fillsPlanned,
    fillsApplied: input.appliedFills.length,
    fillsSkippedRace: input.skippedRacePersonIds.length,
    fills: [...input.appliedFills],
  };
}
