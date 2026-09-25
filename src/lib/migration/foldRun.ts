/**
 * Mode-branching orchestration around the fold-leads planner (design.md
 * "Migration plan" step 4; task 4.3/3.6-equivalent for fold_leads: dry-run
 * mode never writes person rows, execute mode refuses on stale input_hash or
 * missing approval). Mirrors collapseRun.ts's port-shape guarantees: a dry
 * run's ports type doesn't expose `finalizeExecute`, and execute always
 * backs up before writing.
 */
import { planFoldLeads, type FoldExistingPerson, type FoldLeadRow, type FoldPlan } from "./foldPlanner";
import { computeFoldInputHash } from "./inputHash";
import { assertExecutionAllowed, type MigrationRunForGate } from "./executionGuard";

export interface ApprovedFoldRun extends MigrationRunForGate {
  id: string;
  approvedByBdId: string | null;
}

export interface FinalizeFoldExecuteInput {
  plan: FoldPlan;
  migrationRunId: string;
  actorBdId: string;
  backupPath: string;
}

export interface FoldRunPorts {
  saveDryRunReport(input: { inputHash: string; report: FoldPlan["report"] }): Promise<string>;
  snapshotBackup(runId: string): Promise<string>;
  /**
   * One transaction: writes new person rows, updates matched existing
   * persons, writes person_id_map/duplicate_candidate rows, re-points
   * activity/task/signal/linkedin_scrape_job via person_id_map, sets
   * executedAt on the approved migration_run row, and writes one
   * audit_log(migration_execute) entry.
   */
  finalizeExecute(input: FinalizeFoldExecuteInput): Promise<void>;
}

export interface FoldRunResult {
  migrationRunId: string;
  report: FoldPlan["report"];
}

/** Dry run: plans and reports, never writes person rows (contact-migration spec). */
export async function runFoldDryRun(
  existingPersons: FoldExistingPerson[],
  leads: FoldLeadRow[],
  activityTypesByLeadId: ReadonlyMap<string, ReadonlySet<string>>,
  ports: Pick<FoldRunPorts, "saveDryRunReport">,
): Promise<FoldRunResult> {
  const plan = planFoldLeads(existingPersons, leads, activityTypesByLeadId);
  const inputHash = computeFoldInputHash(leads, existingPersons);
  const migrationRunId = await ports.saveDryRunReport({ inputHash, report: plan.report });
  return { migrationRunId, report: plan.report };
}

/**
 * Execute: re-plans from the CURRENT rows, refuses via assertExecutionAllowed
 * unless `approvedRun` is approved, unexecuted, and its hash matches, then
 * backs up and writes — linking back to `approvedRun.id`.
 */
export async function runFoldExecute(
  existingPersons: FoldExistingPerson[],
  leads: FoldLeadRow[],
  activityTypesByLeadId: ReadonlyMap<string, ReadonlySet<string>>,
  approvedRun: ApprovedFoldRun | null,
  ports: Pick<FoldRunPorts, "snapshotBackup" | "finalizeExecute">,
): Promise<FoldRunResult> {
  const plan = planFoldLeads(existingPersons, leads, activityTypesByLeadId);
  const inputHash = computeFoldInputHash(leads, existingPersons);
  assertExecutionAllowed(approvedRun, inputHash, "fold_leads");
  const run = approvedRun as ApprovedFoldRun;

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
