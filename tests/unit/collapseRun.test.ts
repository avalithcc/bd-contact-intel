/**
 * Unit tests for src/lib/migration/collapseRun.ts — the mode-branching
 * orchestration around the collapse planner (contact-migration spec:
 * "Dry-run blocks production execution until reviewed"; task 3.6: "dry-run
 * mode never writes person rows; execute mode refuses on stale input_hash
 * or missing approval"). No real DB — ports are hand-written fakes.
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

function fakePorts() {
  const calls: { saveMigrationRun: unknown[]; writePersons: unknown[] } = {
    saveMigrationRun: [],
    writePersons: [],
  };
  return {
    calls,
    saveMigrationRun: async (input: unknown) => {
      calls.saveMigrationRun.push(input);
      return "run-1";
    },
    writePersons: async (plan: unknown, migrationRunId: unknown) => {
      calls.writePersons.push({ plan, migrationRunId });
    },
  };
}

test("dry run saves a migration_run report and never writes person rows", async () => {
  const ports = fakePorts();
  const rows = [row()];
  const result = await runCollapseDryRun(rows, ports);

  assert.equal(result.migrationRunId, "run-1");
  assert.equal(ports.calls.saveMigrationRun.length, 1);
  assert.equal((ports.calls.saveMigrationRun[0] as { mode: string }).mode, "dry_run");
  assert.equal(ports.calls.writePersons.length, 0, "dry run must never call writePersons");
});

test("execute refuses when the approved run's input hash is stale, and never writes", async () => {
  const ports = fakePorts();
  const rows = [row()];

  await assert.rejects(
    () =>
      runCollapseExecute(rows, { approvedAt: new Date(), inputHash: "stale-hash" }, ports),
    (err: unknown) =>
      err instanceof MigrationExecutionBlockedError && err.reason === "stale_input_hash",
  );
  assert.equal(ports.calls.writePersons.length, 0);
  assert.equal(ports.calls.saveMigrationRun.length, 0);
});

test("execute refuses when the run was never approved, and never writes", async () => {
  const ports = fakePorts();
  const rows = [row()];
  const currentHash = computeCollapseInputHash(rows);

  await assert.rejects(
    () => runCollapseExecute(rows, { approvedAt: null, inputHash: currentHash }, ports),
    (err: unknown) => err instanceof MigrationExecutionBlockedError && err.reason === "not_approved",
  );
  assert.equal(ports.calls.writePersons.length, 0);
});

test("execute writes once the approved run's hash matches the current input", async () => {
  const ports = fakePorts();
  const rows = [row()];
  const currentHash = computeCollapseInputHash(rows);

  const result = await runCollapseExecute(
    rows,
    { approvedAt: new Date(), inputHash: currentHash },
    ports,
  );

  assert.equal(result.migrationRunId, "run-1");
  assert.equal(ports.calls.saveMigrationRun.length, 1);
  assert.equal((ports.calls.saveMigrationRun[0] as { mode: string }).mode, "execute");
  assert.equal(ports.calls.writePersons.length, 1);
});
