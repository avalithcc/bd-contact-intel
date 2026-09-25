/**
 * Mode-branching orchestration around the catch-up planner (task 4B.8;
 * design.md "Catch-up (owner D4b)"; contact-migration spec "Incremental
 * catch-up run"). Mirrors foldRun.ts's port-shape guarantees: dry run never
 * writes identity rows, execute refuses via assertExecutionAllowed on stale
 * input_hash / missing approval / wrong kind, and always backs up before
 * writing.
 */
import type { ExistingPersonCandidate } from "@/lib/identity/resolve";
import { planCatchUp, type CatchUpInput, type CatchUpPlan } from "./catchUpPlanner";
import { assertExecutionAllowed, type MigrationRunForGate } from "./executionGuard";

export interface ApprovedCatchUpRun extends MigrationRunForGate {
  id: string;
  approvedByBdId: string | null;
}

export interface FinalizeCatchUpExecuteInput {
  plan: CatchUpPlan;
  migrationRunId: string;
  actorBdId: string;
  backupPath: string;
}

export interface CatchUpRunPorts {
  saveDryRunReport(input: { inputHash: string; report: CatchUpRunReport }): Promise<string>;
  snapshotBackup(runId: string): Promise<string>;
  finalizeExecute(input: FinalizeCatchUpExecuteInput): Promise<void>;
}

export type CatchUpRunReport = CatchUpPlan["plan"]["report"] & { leadsSkippedNoOwner: number };

export interface CatchUpRunResult {
  migrationRunId: string;
  report: CatchUpRunReport;
}

function reportOf(plan: CatchUpPlan): CatchUpRunReport {
  return { ...plan.plan.report, leadsSkippedNoOwner: plan.leadsSkippedNoOwner };
}

/** Dry run: plans and reports, never writes identity rows (contact-migration spec). */
export async function runCatchUpDryRun(
  input: CatchUpInput,
  existingPersons: readonly ExistingPersonCandidate[],
  ports: Pick<CatchUpRunPorts, "saveDryRunReport">,
): Promise<CatchUpRunResult> {
  const plan = planCatchUp(input, existingPersons);
  const migrationRunId = await ports.saveDryRunReport({ inputHash: plan.inputHash, report: reportOf(plan) });
  return { migrationRunId, report: reportOf(plan) };
}

/**
 * Execute: re-plans from the CURRENT rows, refuses via assertExecutionAllowed
 * unless `approvedRun` is an approved, unexecuted `catch_up` run whose hash
 * matches, then backs up and writes — linking back to `approvedRun.id`.
 */
export async function runCatchUpExecute(
  input: CatchUpInput,
  existingPersons: readonly ExistingPersonCandidate[],
  approvedRun: ApprovedCatchUpRun | null,
  ports: Pick<CatchUpRunPorts, "snapshotBackup" | "finalizeExecute">,
): Promise<CatchUpRunResult> {
  const plan = planCatchUp(input, existingPersons);
  assertExecutionAllowed(approvedRun, plan.inputHash, "catch_up");
  const run = approvedRun as ApprovedCatchUpRun;

  if (!run.approvedByBdId) {
    throw new Error(
      `Cannot execute migration_run ${run.id}: it has no approvedByBdId (the approving bd may ` +
        "have been deleted) — the audit trail would be incomplete.",
    );
  }

  const backupPath = await ports.snapshotBackup(run.id);
  await ports.finalizeExecute({ plan, migrationRunId: run.id, actorBdId: run.approvedByBdId, backupPath });
  return { migrationRunId: run.id, report: reportOf(plan) };
}
