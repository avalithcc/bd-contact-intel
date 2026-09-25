/**
 * Mode-branching orchestration around the collapse planner (design.md
 * "Migration plan" steps 1 and 3; task 3.6: "dry-run mode never writes
 * person rows; execute mode refuses on stale input_hash or missing
 * approval"). No DB/FS access here — callers (scripts/unify-contacts.ts)
 * wire real `src/lib/migration/queries.ts`/`backup.ts` functions as ports.
 * This separation is what keeps the guarantees testable without a
 * database or a real `pg_dump`:
 *  - `runCollapseDryRun`'s ports type doesn't even expose `finalizeExecute`,
 *    so a dry run structurally cannot write person rows.
 *  - `runCollapseExecute` always backs up (`snapshotBackup`) BEFORE calling
 *    `finalizeExecute`, and never calls it at all if the backup rejects.
 */
import { planCollapse, type CollapseContactRow, type CollapsePlan } from "./collapsePlanner";
import { computeCollapseInputHash } from "./inputHash";
import { assertExecutionAllowed, type MigrationRunForGate } from "./executionGuard";

/** The dry-run row `--execute --run=<id>` was pointed at, as fetched from the DB. */
export interface ApprovedMigrationRun extends MigrationRunForGate {
  id: string;
  approvedByBdId: string | null;
}

export interface FinalizeExecuteInput {
  plan: CollapsePlan;
  migrationRunId: string;
  actorBdId: string;
  backupPath: string;
}

export interface CollapseRunPorts {
  /** Persists a fresh `dry_run` migration_run row. Only called from runCollapseDryRun. */
  saveDryRunReport(input: { inputHash: string; report: CollapsePlan["report"] }): Promise<string>;
  /**
   * Backs up the involved tables (see src/lib/migration/backup.ts) before
   * any write. Returns the backup file path, or rejects if the backup or
   * its verification failed — runCollapseExecute treats a rejection here
   * as "abort before writing," never calling `finalizeExecute`.
   */
  snapshotBackup(runId: string): Promise<string>;
  /**
   * One transaction: writes person/person_bd_connection/person_id_map/
   * duplicate_candidate rows, sets `executedAt` on the SAME migration_run
   * row that was approved (never creates a second, orphaned row), and
   * writes one `audit_log(migration_execute)` entry. Only ever called
   * after `assertExecutionAllowed` and `snapshotBackup` have both
   * succeeded.
   */
  finalizeExecute(input: FinalizeExecuteInput): Promise<void>;
}

export interface CollapseRunResult {
  migrationRunId: string;
  report: CollapsePlan["report"];
}

/** Dry run: plans and reports, never writes person rows (contact-migration spec). */
export async function runCollapseDryRun(
  rows: CollapseContactRow[],
  ports: Pick<CollapseRunPorts, "saveDryRunReport">,
): Promise<CollapseRunResult> {
  const plan = planCollapse(rows);
  const inputHash = computeCollapseInputHash(rows);
  const migrationRunId = await ports.saveDryRunReport({ inputHash, report: plan.report });
  return { migrationRunId, report: plan.report };
}

/**
 * Execute: re-plans from the CURRENT rows (not the dry run's cached plan —
 * the input_hash comparison is what proves they're the same rows), refuses
 * via assertExecutionAllowed unless `approvedRun` is approved, unexecuted,
 * and its hash matches, then backs up and writes — linking the result back
 * to `approvedRun.id` rather than creating a new migration_run row.
 */
export async function runCollapseExecute(
  rows: CollapseContactRow[],
  approvedRun: ApprovedMigrationRun | null,
  ports: Pick<CollapseRunPorts, "snapshotBackup" | "finalizeExecute">,
): Promise<CollapseRunResult> {
  const plan = planCollapse(rows);
  const inputHash = computeCollapseInputHash(rows);
  assertExecutionAllowed(approvedRun, inputHash, "collapse");
  // assertExecutionAllowed already guarantees approvedRun is non-null here;
  // this satisfies the type checker without re-deriving that logic.
  const run = approvedRun as ApprovedMigrationRun;

  if (!run.approvedByBdId) {
    throw new Error(
      `Cannot execute migration_run ${run.id}: it has no approvedByBdId (the approving bd may ` +
        "have been deleted) — the audit trail would be incomplete.",
    );
  }

  const backupPath = await ports.snapshotBackup(run.id);
  await ports.finalizeExecute({ plan, migrationRunId: run.id, actorBdId: run.approvedByBdId, backupPath });
  return { migrationRunId: run.id, report: plan.report };
}
