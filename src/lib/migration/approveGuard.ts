/**
 * Owner gate for "Approve dry run" (design.md "Migration plan" step 2;
 * fresh-review WARNING: `approveMigrationRun` approved any `runId`
 * unconditionally). Pure — no DB access, so callers supply the
 * already-fetched migration_run row plus the current latest run id for
 * that kind.
 */
import type { MigrationRunKind } from "./executionGuard";

export type MigrationApproveBlockReason =
  | "not_found"
  | "wrong_kind"
  | "already_executed"
  | "already_approved"
  | "not_latest_dry_run";

export class MigrationApproveBlockedError extends Error {
  constructor(public readonly reason: MigrationApproveBlockReason) {
    super(`Migration approval blocked: ${reason}`);
    this.name = "MigrationApproveBlockedError";
  }
}

export interface MigrationRunForApprove {
  id: string;
  kind: MigrationRunKind;
  approvedAt: Date | null;
  executedAt: Date | null;
}

/**
 * Throws unless `run` exists, matches the `expectedKind` of the section/form
 * that submitted it, has not already been executed, has not already been
 * approved, and is the latest run of its kind (`latestRunIdForKind`) —
 * approving a superseded dry run would let a stale plan get executed later
 * under a fresh-looking approval.
 */
export function assertApprovable(
  run: MigrationRunForApprove | null,
  expectedKind: MigrationRunKind,
  latestRunIdForKind: string | null,
): void {
  if (!run) throw new MigrationApproveBlockedError("not_found");
  if (run.kind !== expectedKind) throw new MigrationApproveBlockedError("wrong_kind");
  if (run.executedAt) throw new MigrationApproveBlockedError("already_executed");
  if (run.approvedAt) throw new MigrationApproveBlockedError("already_approved");
  if (run.id !== latestRunIdForKind) throw new MigrationApproveBlockedError("not_latest_dry_run");
}
