/**
 * Pure revert-selection planner behind
 * scripts/backfill-person-names-from-email.ts's `--revert` mode. No DB
 * access here — see nameFromEmailBackfillRevertDb.ts for the thin DB layer
 * that reads the audit_log row and current DB state.
 *
 * Safety rule (owner ask): revert must NEVER wipe a BD's later correction,
 * and must NEVER touch a `duplicate_candidate` row a human already
 * reviewed. So a person is only reverted if their CURRENT first_name/
 * last_name still equal EXACTLY what this backfill wrote (both fields —
 * see the "only first name changed" test), and a queued
 * `duplicate_candidate` row is only deleted if it is still `status =
 * 'open'` (never `merged`/`not_duplicate`). Everything else is reported as
 * skipped, with the reason, never silently dropped.
 */

export interface AuditedFill {
  personId: string;
  firstName: string;
  lastName: string;
}

export interface CurrentPersonNameState {
  id: string;
  firstName: string | null;
  lastName: string | null;
}

export type PersonRevertSkipReason = "changed_since_backfill" | "not_found";

export interface PersonRevertSkip {
  personId: string;
  reason: PersonRevertSkipReason;
}

export interface AuditedDuplicateCandidateRef {
  id: string;
  personAId: string;
  personBId: string;
}

export interface CurrentDuplicateCandidateState {
  id: string;
  status: string;
}

export interface DuplicateCandidateRevertSkip {
  id: string;
  /** "not_found", or the row's actual current status (e.g. "merged",
   * "not_duplicate") — never "open", since an open row is always reverted. */
  reason: string;
}

export interface NameFromEmailRevertPlan {
  personIdsToRevert: string[];
  personsSkipped: PersonRevertSkip[];
  duplicateCandidateIdsToDelete: string[];
  duplicateCandidatesSkipped: DuplicateCandidateRevertSkip[];
}

/**
 * Pure — never mutates any input; safe to call twice with the same input
 * for the same result (see tests/unit/nameFromEmailBackfillRevert.test.ts).
 */
export function buildNameFromEmailRevertPlan(input: {
  auditedFills: readonly AuditedFill[];
  currentPersons: readonly CurrentPersonNameState[];
  auditedDuplicateCandidates: readonly AuditedDuplicateCandidateRef[];
  currentDuplicateCandidates: readonly CurrentDuplicateCandidateState[];
}): NameFromEmailRevertPlan {
  const currentPersonById = new Map(input.currentPersons.map((p) => [p.id, p] as const));
  const personIdsToRevert: string[] = [];
  const personsSkipped: PersonRevertSkip[] = [];

  for (const fill of input.auditedFills) {
    const current = currentPersonById.get(fill.personId);
    if (!current) {
      personsSkipped.push({ personId: fill.personId, reason: "not_found" });
    } else if (current.firstName === fill.firstName && current.lastName === fill.lastName) {
      personIdsToRevert.push(fill.personId);
    } else {
      personsSkipped.push({ personId: fill.personId, reason: "changed_since_backfill" });
    }
  }

  const currentDuplicateCandidateById = new Map(input.currentDuplicateCandidates.map((d) => [d.id, d] as const));
  const duplicateCandidateIdsToDelete: string[] = [];
  const duplicateCandidatesSkipped: DuplicateCandidateRevertSkip[] = [];

  for (const ref of input.auditedDuplicateCandidates) {
    const current = currentDuplicateCandidateById.get(ref.id);
    if (!current) {
      duplicateCandidatesSkipped.push({ id: ref.id, reason: "not_found" });
    } else if (current.status === "open") {
      duplicateCandidateIdsToDelete.push(ref.id);
    } else {
      duplicateCandidatesSkipped.push({ id: ref.id, reason: current.status });
    }
  }

  return { personIdsToRevert, personsSkipped, duplicateCandidateIdsToDelete, duplicateCandidatesSkipped };
}
