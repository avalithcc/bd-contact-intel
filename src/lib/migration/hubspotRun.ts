/**
 * Mode-branching orchestration around the HubSpot import planner (design D6,
 * task 4.2). Mirrors catchUpRun.ts's port-shape guarantees: dry run never
 * writes `person`/`company` rows (task 4.9), execute refuses via
 * `assertExecutionAllowed` on stale `input_hash` / missing approval / wrong
 * kind / an unconfirmed over-threshold review count (hubspot-import spec
 * "Review-count threshold gate"), and always backs up before writing.
 *
 * Deliberately does NOT re-hash the DB snapshot a second time inside the
 * execute transaction's lock (design D6 step 3's "re-prefetch and re-hash
 * inside the lock" is aspirational): `catchUpQueries.ts#finalizeCatchUpExecute`
 * already established this exact scope reduction for the same reason (see
 * its header) — the pre-transaction `assertExecutionAllowed` hash check plus
 * `snapshotBackup` is the same defense every other phase relies on. Treated
 * as a documented residual risk, not silently dropped.
 */
import type { HubSpotContactRow } from "@/lib/hubspot/contacts";
import { planHubSpotImport, type PlanHubSpotImportInput, type PlanHubSpotImportResult } from "@/lib/hubspot/planner";
import {
  buildHubSpotRunReport,
  type HubSpotReviewExistingPerson,
  type HubSpotRunReport,
} from "@/lib/hubspot/report";
import { assertExecutionAllowed, type MigrationRunForGate } from "./executionGuard";

export interface ApprovedHubSpotRun extends MigrationRunForGate {
  id: string;
  approvedByBdId: string | null;
}

export interface FinalizeHubSpotExecuteInput {
  plan: PlanHubSpotImportResult;
  migrationRunId: string;
  actorBdId: string;
  backupPath: string;
}

export interface HubSpotRunPorts {
  saveDryRunReport(input: { inputHash: string; report: HubSpotRunReport }): Promise<string>;
  snapshotBackup(runId: string): Promise<string>;
  finalizeExecute(input: FinalizeHubSpotExecuteInput): Promise<void>;
}

export interface HubSpotRunResult {
  migrationRunId: string;
  report: HubSpotRunReport;
}

function contactsById(contacts: readonly HubSpotContactRow[]): Map<string, HubSpotContactRow> {
  return new Map(contacts.map((c) => [c.hubspotContactId, c]));
}

function existingByIdFromIdentityIndex(
  identityIndex: PlanHubSpotImportInput["identityIndex"],
): Map<string, HubSpotReviewExistingPerson> {
  return new Map(
    identityIndex.map((p) => [p.id, { firstName: p.firstName, lastName: p.lastName, companyKey: p.companyKey }]),
  );
}

function reportOf(input: PlanHubSpotImportInput, plan: PlanHubSpotImportResult): HubSpotRunReport {
  return buildHubSpotRunReport(plan, contactsById(input.contacts), existingByIdFromIdentityIndex(input.identityIndex));
}

/** Dry run: plans and reports, never writes `person`/`company` rows
 * (hubspot-import spec "PII-safe dry-run report" / task 4.9). */
export async function runHubSpotImportDryRun(
  input: PlanHubSpotImportInput,
  inputHash: string,
  ports: Pick<HubSpotRunPorts, "saveDryRunReport">,
): Promise<HubSpotRunResult> {
  const plan = planHubSpotImport(input);
  const report = reportOf(input, plan);
  const migrationRunId = await ports.saveDryRunReport({ inputHash, report });
  return { migrationRunId, report };
}

/**
 * Execute: re-plans from the CURRENT rows, refuses via
 * `assertExecutionAllowed` unless `approvedRun` is an approved, unexecuted
 * `hubspot_import` run whose hash matches (and, if `review` exceeded
 * `HUBSPOT_REVIEW_THRESHOLD`, was explicitly confirmed), then backs up and
 * writes — linking back to `approvedRun.id`.
 */
export async function runHubSpotImportExecute(
  input: PlanHubSpotImportInput,
  inputHash: string,
  approvedRun: ApprovedHubSpotRun | null,
  ports: Pick<HubSpotRunPorts, "snapshotBackup" | "finalizeExecute">,
): Promise<HubSpotRunResult> {
  const plan = planHubSpotImport(input);
  assertExecutionAllowed(approvedRun, inputHash, "hubspot_import");
  const run = approvedRun as ApprovedHubSpotRun;

  if (!run.approvedByBdId) {
    throw new Error(
      `Cannot execute migration_run ${run.id}: it has no approvedByBdId (the approving bd may ` +
        "have been deleted) — the audit trail would be incomplete.",
    );
  }

  const backupPath = await ports.snapshotBackup(run.id);
  await ports.finalizeExecute({ plan, migrationRunId: run.id, actorBdId: run.approvedByBdId, backupPath });
  return { migrationRunId: run.id, report: reportOf(input, plan) };
}
