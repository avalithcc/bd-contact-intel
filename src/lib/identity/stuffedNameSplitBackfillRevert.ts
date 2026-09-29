/**
 * Pure revert-selection planner behind
 * scripts/backfill-split-stuffed-names.ts's `--revert` mode. Mirrors
 * src/lib/identity/nameFromEmailBackfillRevert.ts's safety rule: a person is
 * only reverted if their CURRENT first_name/last_name still equal EXACTLY
 * what this backfill wrote (a BD's later correction is never silently
 * wiped). Everything else is reported as skipped, with the reason.
 */

export interface AuditedStuffedNameSplitFill {
  personId: string;
  firstName: string;
  lastName: string;
  originalFirstName: string;
  originalLastName: string | null;
}

export interface CurrentPersonNameState {
  id: string;
  firstName: string | null;
  lastName: string | null;
}

export type StuffedNameSplitRevertSkipReason = "changed_since_backfill" | "not_found";

export interface StuffedNameSplitRevertSkip {
  personId: string;
  reason: StuffedNameSplitRevertSkipReason;
}

export interface StuffedNameSplitRevertItem {
  personId: string;
  originalFirstName: string;
  originalLastName: string | null;
}

export interface StuffedNameSplitRevertPlan {
  toRevert: StuffedNameSplitRevertItem[];
  skipped: StuffedNameSplitRevertSkip[];
}

/**
 * Pure — never mutates any input; safe to call twice with the same input for
 * the same result (see tests/unit/stuffedNameSplitBackfillRevert.test.ts).
 */
export function buildStuffedNameSplitRevertPlan(input: {
  auditedFills: readonly AuditedStuffedNameSplitFill[];
  currentPersons: readonly CurrentPersonNameState[];
}): StuffedNameSplitRevertPlan {
  const currentById = new Map(input.currentPersons.map((p) => [p.id, p] as const));
  const toRevert: StuffedNameSplitRevertItem[] = [];
  const skipped: StuffedNameSplitRevertSkip[] = [];

  for (const fill of input.auditedFills) {
    const current = currentById.get(fill.personId);
    if (!current) {
      skipped.push({ personId: fill.personId, reason: "not_found" });
    } else if (current.firstName === fill.firstName && current.lastName === fill.lastName) {
      toRevert.push({
        personId: fill.personId,
        originalFirstName: fill.originalFirstName,
        originalLastName: fill.originalLastName,
      });
    } else {
      skipped.push({ personId: fill.personId, reason: "changed_since_backfill" });
    }
  }

  return { toRevert, skipped };
}

// --- Audit row selection (same CRITICAL fix as nameFromEmailBackfillRevert) -

export interface StuffedNameSplitAuditSummary {
  id: string;
  at: Date;
  actorBdId: string;
  fillCount: number;
}

export interface StuffedNameSplitAuditRowForSelection {
  id: string;
  at: Date;
  actorBdId: string;
  fills: AuditedStuffedNameSplitFill[];
}

export type StuffedNameSplitAuditSelection =
  | { kind: "none" }
  | { kind: "selected"; row: StuffedNameSplitAuditRowForSelection }
  | { kind: "ambiguous"; candidates: StuffedNameSplitAuditSummary[] }
  | { kind: "not_found"; requestedAuditId: string; candidates: StuffedNameSplitAuditSummary[] };

function isNonEmptyAuditRow(row: StuffedNameSplitAuditRowForSelection): boolean {
  return row.fills.length > 0;
}

function toAuditSummary(row: StuffedNameSplitAuditRowForSelection): StuffedNameSplitAuditSummary {
  return { id: row.id, at: row.at, actorBdId: row.actorBdId, fillCount: row.fills.length };
}

/**
 * Pure — never mutates `rows`. Never just picks the "latest" row: if more
 * than one non-empty row exists and no `auditId` was given, refuses and
 * lists every candidate so the operator picks one explicitly.
 */
export function selectStuffedNameSplitAuditRow(
  rows: readonly StuffedNameSplitAuditRowForSelection[],
  auditId: string | null,
): StuffedNameSplitAuditSelection {
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
