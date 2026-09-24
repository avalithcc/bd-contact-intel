/**
 * Unit tests for src/lib/migration/collapseRun.ts — the mode-branching
 * orchestration around the collapse planner (contact-migration spec:
 * "Dry-run blocks production execution until reviewed"; task 3.6: "dry-run
 * mode never writes person rows; execute mode refuses on stale input_hash
 * or missing approval"; fresh-review fix: execution bookkeeping links back
 * to the approved run and backs up before writing). No real DB — ports are
 * hand-written fakes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { runCollapseDryRun, runCollapseExecute } from "@/lib/migration/collapseRun";
import { MigrationExecutionBlockedError } from "@/lib/migration/executionGuard";
import { computeCollapseInputHash } from "@/lib/migration/inputHash";
import type { CollapseContactRow } from "@/lib/migration/collapsePlanner";

function row(overrides: Partial<CollapseContactRow> = {}): CollapseContactRow {
  return {
    id: "c1",
    bdId: "bd-1",
    profileKey: "linkedin.com/in/janedoe",
    firstName: "Jane",
    lastName: "Doe",
    company: "Acme",
    companyKey: "acme",
    companyCategory: "product_saas",
    roleGroup: "engineering_manager",
    position: "Engineering Manager",
    industry: null,
    email: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    connectedOn: "1 Jan 2020",
    ...overrides,
  };
}

function approvedRun(overrides: Partial<Parameters<typeof runCollapseExecute>[1]> = {}) {
  return {
    id: "run-1",
    approvedAt: new Date(),
    executedAt: null,
    approvedByBdId: "admin-bd-1",
    inputHash: "",
    ...overrides,
  };
}

function fakePorts() {
  const calls: {
    saveDryRunReport: unknown[];
    snapshotBackup: unknown[];
    finalizeExecute: unknown[];
  } = { saveDryRunReport: [], snapshotBackup: [], finalizeExecute: [] };
  return {
    calls,
    saveDryRunReport: async (input: unknown) => {
      calls.saveDryRunReport.push(input);
      return "run-1";
    },
    snapshotBackup: async (runId: unknown) => {
      calls.snapshotBackup.push(runId);
      return "backups/run-1-2026-01-01T00-00-00.dump";
    },
    finalizeExecute: async (input: unknown) => {
      calls.finalizeExecute.push(input);
    },
  };
}

test("dry run saves a migration_run report and never touches execute-only ports", async () => {
  const ports = fakePorts();
  const rows = [row()];
  const result = await runCollapseDryRun(rows, ports);

  assert.equal(result.migrationRunId, "run-1");
  assert.equal(ports.calls.saveDryRunReport.length, 1);
  assert.equal(ports.calls.snapshotBackup.length, 0);
  assert.equal(ports.calls.finalizeExecute.length, 0, "dry run must never call finalizeExecute");
});

test("execute refuses when the approved run's input hash is stale, backs up nothing, writes nothing", async () => {
  const ports = fakePorts();
  const rows = [row()];

  await assert.rejects(
    () => runCollapseExecute(rows, approvedRun({ inputHash: "stale-hash" }), ports),
    (err: unknown) => err instanceof MigrationExecutionBlockedError && err.reason === "stale_input_hash",
  );
  assert.equal(ports.calls.snapshotBackup.length, 0);
  assert.equal(ports.calls.finalizeExecute.length, 0);
});

test("execute refuses when the run was never approved", async () => {
  const ports = fakePorts();
  const rows = [row()];
  const currentHash = computeCollapseInputHash(rows);

  await assert.rejects(
    () => runCollapseExecute(rows, approvedRun({ approvedAt: null, inputHash: currentHash }), ports),
    (err: unknown) => err instanceof MigrationExecutionBlockedError && err.reason === "not_approved",
  );
  assert.equal(ports.calls.snapshotBackup.length, 0);
  assert.equal(ports.calls.finalizeExecute.length, 0);
});

test("execute refuses when the run has already been executed", async () => {
  const ports = fakePorts();
  const rows = [row()];
  const currentHash = computeCollapseInputHash(rows);

  await assert.rejects(
    () =>
      runCollapseExecute(
        rows,
        approvedRun({ executedAt: new Date(), inputHash: currentHash }),
        ports,
      ),
    (err: unknown) => err instanceof MigrationExecutionBlockedError && err.reason === "already_executed",
  );
  assert.equal(ports.calls.snapshotBackup.length, 0);
  assert.equal(ports.calls.finalizeExecute.length, 0);
});

test("execute refuses when the approved run has no approvedByBdId (audit trail would be incomplete)", async () => {
  const ports = fakePorts();
  const rows = [row()];
  const currentHash = computeCollapseInputHash(rows);

  await assert.rejects(() =>
    runCollapseExecute(rows, approvedRun({ approvedByBdId: null, inputHash: currentHash }), ports),
  );
  assert.equal(ports.calls.snapshotBackup.length, 0);
  assert.equal(ports.calls.finalizeExecute.length, 0);
});

test("execute aborts before writing when the backup fails", async () => {
  const ports = fakePorts();
  ports.snapshotBackup = async () => {
    throw new Error("pg_dump exited with code 1");
  };
  const rows = [row()];
  const currentHash = computeCollapseInputHash(rows);

  await assert.rejects(
    () => runCollapseExecute(rows, approvedRun({ inputHash: currentHash }), ports),
    /pg_dump exited with code 1/,
  );
  assert.equal(ports.calls.finalizeExecute.length, 0, "must not write if the backup failed");
});

test("execute backs up, then finalizes into the approved run (no orphan row)", async () => {
  const ports = fakePorts();
  const rows = [row()];
  const currentHash = computeCollapseInputHash(rows);

  const result = await runCollapseExecute(rows, approvedRun({ inputHash: currentHash }), ports);

  assert.equal(result.migrationRunId, "run-1");
  assert.equal(ports.calls.saveDryRunReport.length, 0, "execute must never create a new migration_run row");
  assert.equal(ports.calls.snapshotBackup.length, 1);
  assert.deepEqual(ports.calls.snapshotBackup[0], "run-1");
  assert.equal(ports.calls.finalizeExecute.length, 1);
  const finalizeCall = ports.calls.finalizeExecute[0] as {
    migrationRunId: string;
    actorBdId: string;
    backupPath: string;
  };
  assert.equal(finalizeCall.migrationRunId, "run-1");
  assert.equal(finalizeCall.actorBdId, "admin-bd-1");
  assert.equal(finalizeCall.backupPath, "backups/run-1-2026-01-01T00-00-00.dump");
});
