/**
 * Owner gate for "Approve dry run" (design.md "Migration plan" step 2;
 * fresh-review WARNING: `approveMigrationRun` approved any `runId`
 * unconditionally). Pure — no DB access, so callers supply the
 * already-fetched migration_run row plus the current latest run id for
 * that kind.
 */
import type { MigrationRunKind } from "./executionGuard";
import { HUBSPOT_REVIEW_THRESHOLD } from "@/lib/hubspot/report";

export type MigrationApproveBlockReason =
  | "not_found"
  | "wrong_kind"
  | "already_executed"
  | "already_approved"
  | "not_latest_dry_run"
  | "review_threshold_unconfirmed";

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
  // hubspot_import only (design D7 "Threshold"): the dry-run report's
  // `review` count. Approving above HUBSPOT_REVIEW_THRESHOLD requires the
  // owner to explicitly tick "Confirmo N contactos a revisar" — see
  // `confirmedThreshold` below. Ignored for every other kind.
  reviewCount?: number;
}

/**
 * Throws unless `run` exists, matches the `expectedKind` of the section/form
 * that submitted it, has not already been executed, has not already been
 * approved, is the latest run of its kind (`latestRunIdForKind`) —
 * approving a superseded dry run would let a stale plan get executed later
 * under a fresh-looking approval — and, for `hubspot_import` runs whose
 * `reviewCount` exceeds `HUBSPOT_REVIEW_THRESHOLD`, that the owner passed
 * `confirmedThreshold: true` (the page's confirmation checkbox).
 */
export function assertApprovable(
  run: MigrationRunForApprove | null,
  expectedKind: MigrationRunKind,
  latestRunIdForKind: string | null,
  confirmedThreshold = false,
): void {
  if (!run) throw new MigrationApproveBlockedError("not_found");
  if (run.kind !== expectedKind) throw new MigrationApproveBlockedError("wrong_kind");
  if (run.executedAt) throw new MigrationApproveBlockedError("already_executed");
  if (run.approvedAt) throw new MigrationApproveBlockedError("already_approved");
  if (run.id !== latestRunIdForKind) throw new MigrationApproveBlockedError("not_latest_dry_run");
  if (
    expectedKind === "hubspot_import" &&
    (run.reviewCount ?? 0) > HUBSPOT_REVIEW_THRESHOLD &&
    !confirmedThreshold
  ) {
    throw new MigrationApproveBlockedError("review_threshold_unconfirmed");
  }
}
