/**
 * Pure audit_log metadata builder for
 * scripts/backfill-person-names-from-email.ts's `--execute` path.
 *
 * `fills` stores each applied fill's personId AND the exact firstName/
 * lastName this run wrote — needed by the revert planner
 * (nameFromEmailBackfillRevert.ts) to only revert a row whose CURRENT name
 * still equals what THIS run wrote (a BD's later correction must never be
 * silently wiped). The derived name is not new PII beyond what the row
 * itself already carries (it's the very value already sitting in
 * `person.first_name`/`last_name`) — unlike an email, it's fine to persist
 * here for the revert path.
 *
 * `duplicateCandidatesQueued` stores the `duplicate_candidate.id` (plus its
 * personA/personB) of every row THIS run inserted — the revert path only
 * ever deletes a row from this exact list, and only if it's still `open`
 * (never a reviewed one) — see nameFromEmailBackfillRevert.ts.
 *
 * Revert path: given an audit_log row's metadata (action =
 * 'person_name_from_email_backfill'), run
 *   npx tsx --env-file=.env.local scripts/backfill-person-names-from-email.ts --revert
 * (dry run) then `--revert --execute --actor=<bd id>` — see
 * nameFromEmailBackfillRevert.ts for the exact selection rule.
 */

/** Above this many entries, the audit row keeps the count accurate but caps
 * the persisted list — same convention as
 * COMPANY_DOMAIN_BACKFILL_AUDIT_KEY_CAP. Applies to both `fills` and
 * `duplicateCandidatesQueued` independently. */
export const NAME_FROM_EMAIL_BACKFILL_AUDIT_CAP = 5000;

export interface AppliedNameFromEmailFill {
  personId: string;
  firstName: string;
  lastName: string;
}

export interface QueuedDuplicateCandidateRef {
  id: string;
  personAId: string;
  personBId: string;
}

export interface NameFromEmailBackfillAuditMetadata {
  /** How many fills the planner found (before this run started writing). */
  fillsPlanned: number;
  /** How many fills were ACTUALLY applied (rows changed) — the write-time
   * source of truth, may be less than `fillsPlanned` if a row's name was no
   * longer empty by write time (`fillsSkippedRace`). */
  fillsApplied: number;
  /** Fills skipped at write time because the person's name was no longer
   * empty (changed by something else between the read and this execute) —
   * reported, never silently dropped. */
  fillsSkippedRace: number;
  /** Every fill actually applied (personId + the exact firstName/lastName
   * written), capped at NAME_FROM_EMAIL_BACKFILL_AUDIT_CAP — the revert list. */
  fills: AppliedNameFromEmailFill[];
  /** True when `fills` was capped (fillsApplied is still accurate). */
  fillsTruncated: boolean;
  /** Every `duplicate_candidate` row THIS run inserted, capped — the
   * revert-delete list. */
  duplicateCandidatesQueued: QueuedDuplicateCandidateRef[];
  /** True when `duplicateCandidatesQueued` was capped. */
  duplicateCandidatesQueuedTruncated: boolean;
  /** How many planned pairs were NOT inserted because a `duplicate_candidate`
   * row already existed for that pair (any status) — informational only,
   * never part of the revert (this run didn't create them). */
  duplicateCandidatesAlreadyQueued: number;
}

/**
 * CRITICAL fix: an `--execute` run that applies ZERO fills and queues ZERO
 * duplicate_candidate rows (e.g. someone re-running `--execute` "to check"
 * after the real backfill already ran) must NOT write an audit_log row —
 * it would become the newest row and hide the real backfill from
 * `--revert`'s row-selection (see nameFromEmailBackfillRevert.ts). Callers
 * must check this BEFORE inserting into audit_log; skip the insert (and
 * print "nothing to do") when it returns false.
 */
export function isNameFromEmailBackfillAuditWorthRecording(input: {
  appliedFills: readonly unknown[];
  queuedDuplicateCandidates: readonly unknown[];
}): boolean {
  return input.appliedFills.length > 0 || input.queuedDuplicateCandidates.length > 0;
}

export function buildNameFromEmailBackfillAuditMetadata(input: {
  fillsPlanned: number;
  appliedFills: readonly AppliedNameFromEmailFill[];
  skippedRacePersonIds: readonly string[];
  queuedDuplicateCandidates: readonly QueuedDuplicateCandidateRef[];
  alreadyQueuedDuplicateCandidatesCount: number;
}): NameFromEmailBackfillAuditMetadata {
  const fillsTruncated = input.appliedFills.length > NAME_FROM_EMAIL_BACKFILL_AUDIT_CAP;
  const duplicateCandidatesQueuedTruncated =
    input.queuedDuplicateCandidates.length > NAME_FROM_EMAIL_BACKFILL_AUDIT_CAP;

  return {
    fillsPlanned: input.fillsPlanned,
    fillsApplied: input.appliedFills.length,
    fillsSkippedRace: input.skippedRacePersonIds.length,
    fills: fillsTruncated
      ? input.appliedFills.slice(0, NAME_FROM_EMAIL_BACKFILL_AUDIT_CAP)
      : [...input.appliedFills],
    fillsTruncated,
    duplicateCandidatesQueued: duplicateCandidatesQueuedTruncated
      ? input.queuedDuplicateCandidates.slice(0, NAME_FROM_EMAIL_BACKFILL_AUDIT_CAP)
      : [...input.queuedDuplicateCandidates],
    duplicateCandidatesQueuedTruncated,
    duplicateCandidatesAlreadyQueued: input.alreadyQueuedDuplicateCandidatesCount,
  };
}
