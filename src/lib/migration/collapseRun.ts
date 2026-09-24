/**
 * Mode-branching orchestration around the collapse planner (design.md
 * "Migration plan" steps 1 and 3; task 3.6: "dry-run mode never writes
 * person rows; execute mode refuses on stale input_hash or missing
 * approval"). No DB access here — callers (scripts/unify-contacts.ts) wire
 * real `src/lib/migration/queries.ts` functions as ports. This separation
 * is what keeps the guarantee testable without a database:
 * `runCollapseDryRun`'s ports type doesn't even expose `writePersons`, so a
 * dry run structurally cannot reach it.
 */
import { planCollapse, type CollapseContactRow, type CollapsePlan } from "./collapsePlanner";
import { computeCollapseInputHash } from "./inputHash";
import { assertExecutionAllowed, type MigrationRunForGate } from "./executionGuard";

export type CollapseRunMode = "dry_run" | "execute";

export interface CollapseRunPorts {
  /** Persists the migration_run row. Called in both modes. */
  saveMigrationRun(input: {
    mode: CollapseRunMode;
    inputHash: string;
    report: CollapsePlan["report"];
  }): Promise<string>;
  /**
   * Writes person/person_bd_connection/person_id_map/duplicate_candidate
   * rows. Only ever called from `runCollapseExecute`, after
   * `assertExecutionAllowed` has passed.
   */
  writePersons(plan: CollapsePlan, migrationRunId: string): Promise<void>;
}

export interface CollapseRunResult {
  migrationRunId: string;
  report: CollapsePlan["report"];
}

/** Dry run: plans and reports, never writes person rows (contact-migration spec). */
export async function runCollapseDryRun(
  rows: CollapseContactRow[],
  ports: Pick<CollapseRunPorts, "saveMigrationRun">,
): Promise<CollapseRunResult> {
  const plan = planCollapse(rows);
  const inputHash = computeCollapseInputHash(rows);
  const migrationRunId = await ports.saveMigrationRun({
    mode: "dry_run",
    inputHash,
    report: plan.report,
  });
  return { migrationRunId, report: plan.report };
}

/**
 * Execute: re-plans from the CURRENT rows (not the dry run's cached plan —
 * the input_hash comparison is what proves they're the same rows), refuses
 * via assertExecutionAllowed unless `approvedRun` is approved and its hash
 * matches, then writes.
 */
export async function runCollapseExecute(
  rows: CollapseContactRow[],
  approvedRun: MigrationRunForGate | null,
  ports: CollapseRunPorts,
): Promise<CollapseRunResult> {
  const plan = planCollapse(rows);
  const inputHash = computeCollapseInputHash(rows);
  assertExecutionAllowed(approvedRun, inputHash);

  const migrationRunId = await ports.saveMigrationRun({ mode: "execute", inputHash, report: plan.report });
  await ports.writePersons(plan, migrationRunId);
  return { migrationRunId, report: plan.report };
}
