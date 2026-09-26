/**
 * Owner gate for `--execute --run=<id>` (design.md "Migration plan"; R10,
 * R13; contact-migration spec "Dry-run blocks production execution until
 * reviewed"). Pure — no DB access, so callers supply the already-fetched
 * migration_run row.
 */
import { HUBSPOT_REVIEW_THRESHOLD } from "@/lib/hubspot/report";

export type MigrationRunKind = "collapse" | "fold_leads" | "catch_up" | "hubspot_import";

export type MigrationExecutionBlockReason =
  | "not_found"
  | "not_approved"
  | "already_executed"
  | "wrong_kind"
  | "stale_input_hash"
  | "review_threshold_unconfirmed";

export class MigrationExecutionBlockedError extends Error {
  constructor(public readonly reason: MigrationExecutionBlockReason) {
    super(`Migration execution blocked: ${reason}`);
    this.name = "MigrationExecutionBlockedError";
  }
}

export interface MigrationRunForGate {
  kind: MigrationRunKind;
  approvedAt: Date | null;
  executedAt: Date | null;
  inputHash: string;
  // hubspot_import only (hubspot-import spec "Review-count threshold gate"):
  // the dry-run report's `review` count and whether the owner explicitly
  // confirmed proceeding despite it exceeding HUBSPOT_REVIEW_THRESHOLD. The
  // primary UX gate lives in the approve action (Phase 5); this is a
  // defense-in-depth check so --execute itself can never bypass it, even if
  // a run was somehow approved without going through that action.
  reviewCount?: number;
  reviewThresholdConfirmed?: boolean;
}

/**
 * Throws unless `run` exists, has been approved by an admin
 * (`/admin/migration`), has not already been executed, matches the
 * `expectedKind` the caller is about to execute, and its stored `inputHash`
 * still matches the current input — i.e. the underlying `contact`/`lead`
 * rows have not changed since the dry run the owner reviewed.
 *
 * `already_executed` is checked BEFORE `wrong_kind`/`stale_input_hash`
 * deliberately: a second `--execute` on the same run must always get the
 * same clear "already executed" message, never a kind or hash mismatch
 * (which would only be true by coincidence) and never a raw DB constraint
 * violation from trying to write the same rows twice.
 *
 * `wrong_kind` is checked BEFORE `stale_input_hash`: running
 * `--phase=fold_leads --execute --run=<id>` against a `collapse` dry run
 * must be refused explicitly, not incidentally via a hash mismatch that
 * could coincidentally match.
 *
 * `review_threshold_unconfirmed` (hubspot_import only) is checked AFTER
 * `wrong_kind` but BEFORE `stale_input_hash`: a distinct, explicit reason
 * beats an incidental hash mismatch, and this is a content-independent
 * approval-state check, same tier as `wrong_kind`.
 */
export function assertExecutionAllowed(
  run: MigrationRunForGate | null,
  currentInputHash: string,
  expectedKind: MigrationRunKind,
): void {
  if (!run) throw new MigrationExecutionBlockedError("not_found");
  if (!run.approvedAt) throw new MigrationExecutionBlockedError("not_approved");
  if (run.executedAt) throw new MigrationExecutionBlockedError("already_executed");
  if (run.kind !== expectedKind) throw new MigrationExecutionBlockedError("wrong_kind");
  if (
    expectedKind === "hubspot_import" &&
    (run.reviewCount ?? 0) > HUBSPOT_REVIEW_THRESHOLD &&
    !run.reviewThresholdConfirmed
  ) {
    throw new MigrationExecutionBlockedError("review_threshold_unconfirmed");
  }
  if (run.inputHash !== currentInputHash) {
    throw new MigrationExecutionBlockedError("stale_input_hash");
  }
}
