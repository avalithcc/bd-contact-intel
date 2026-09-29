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

// --- Audit row selection (CRITICAL fix) -------------------------------------
// Revert must NEVER just take the "latest" audit_log row: an empty re-run
// used to still insert a row (fixed separately in
// nameFromEmailBackfillAudit.ts#isNameFromEmailBackfillAuditWorthRecording),
// and defensively, this selector also ignores any row it's given that
// records no fills and no queued candidates — belt and suspenders. When
// more than one real (non-empty) row exists, revert refuses by default and
// lists every candidate so the operator can pick one explicitly via
// --audit-id=<uuid>.

export interface NameFromEmailBackfillAuditSummary {
  id: string;
  at: Date;
  actorBdId: string;
  fillCount: number;
  queuedCount: number;
}

export interface NameFromEmailBackfillAuditRowForSelection {
  id: string;
  at: Date;
  actorBdId: string;
  fills: AuditedFill[];
  duplicateCandidatesQueued: AuditedDuplicateCandidateRef[];
}

export type NameFromEmailBackfillAuditSelection =
  | { kind: "none" }
  | { kind: "selected"; row: NameFromEmailBackfillAuditRowForSelection }
  | { kind: "ambiguous"; candidates: NameFromEmailBackfillAuditSummary[] }
  | { kind: "not_found"; requestedAuditId: string; candidates: NameFromEmailBackfillAuditSummary[] };

function isNonEmptyAuditRow(row: NameFromEmailBackfillAuditRowForSelection): boolean {
  return row.fills.length > 0 || row.duplicateCandidatesQueued.length > 0;
}

function toAuditSummary(row: NameFromEmailBackfillAuditRowForSelection): NameFromEmailBackfillAuditSummary {
  return {
    id: row.id,
    at: row.at,
    actorBdId: row.actorBdId,
    fillCount: row.fills.length,
    queuedCount: row.duplicateCandidatesQueued.length,
  };
}

/**
 * Pure — never mutates `rows`. Filters out any row recording no fills and no
 * queued candidates (legacy/defensive — see
 * isNameFromEmailBackfillAuditWorthRecording, which should prevent these
 * from ever being written, but this selector never trusts that alone).
 * `auditId`, when given, must match a NON-EMPTY row — an id that only
 * matches an empty row is reported as not_found, never silently accepted.
 */
export function selectNameFromEmailBackfillAuditRow(
  rows: readonly NameFromEmailBackfillAuditRowForSelection[],
  auditId: string | null,
): NameFromEmailBackfillAuditSelection {
  const nonEmpty = rows.filter(isNonEmptyAuditRow);

  if (auditId) {
    const match = nonEmpty.find((r) => r.id === auditId);
    if (match) return { kind: "selected", row: match };
    return { kind: "not_found", requestedAuditId: auditId, candidates: nonEmpty.map(toAuditSummary) };
  }

  if (nonEmpty.length === 0) return { kind: "none" };
  if (nonEmpty.length === 1) return { kind: "selected", row: nonEmpty[0]! };
  return { kind: "ambiguous", candidates: nonEmpty.map(toAuditSummary) };
}
