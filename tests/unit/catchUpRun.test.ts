/**
 * Unit tests for src/lib/migration/catchUpRun.ts — mode-branching
 * orchestration around the catch-up planner (task 4B.8), mirroring
 * foldRun.ts's guarantees: dry run never writes identity rows, execute
 * refuses on stale input_hash or missing approval, and always backs up
 * before writing. No real DB — ports are hand-written fakes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { runCatchUpDryRun, runCatchUpExecute } from "@/lib/migration/catchUpRun";
import { MigrationExecutionBlockedError } from "@/lib/migration/executionGuard";
import { computeCatchUpInputHash } from "@/lib/migration/inputHash";
import type { CatchUpContactRow, CatchUpLeadRow } from "@/lib/migration/catchUpPlanner";
import type { ExistingPersonCandidate } from "@/lib/identity/resolve";

function contactRow(): CatchUpContactRow {
  return {
    id: "contact-1",
    bdId: "bd-1",
    profileKey: "linkedin.com/in/nuevo",
    firstName: "Nuevo",
    lastName: "Contacto",
    company: "Acme",
    companyKey: "acme",
    position: "CTO",
    industry: null,
    connectedOn: null,
    email: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
  };
}

function leadRow(): CatchUpLeadRow {
  return {
    id: "lead-1",
    ownerBdId: "bd-1",
    firstName: "Carla",
    lastName: "Diaz",
    companyDisplay: "Other Co",
    companyRaw: null,
    companyKey: "other",
    jobTitle: null,
    industryGroup: null,
    industryRaw: null,
    email: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
  };
}

const noExistingPersons: ExistingPersonCandidate[] = [];

function approvedRun(overrides: Partial<Parameters<typeof runCatchUpExecute>[2] & object> = {}) {
  return {
    id: "run-1",
    kind: "catch_up" as const,
    approvedAt: new Date(),
    executedAt: null,
    approvedByBdId: "admin-bd-1",
    inputHash: "",
    ...overrides,
  };
}

function fakePorts() {
  const calls: { saveDryRunReport: unknown[]; snapshotBackup: unknown[]; finalizeExecute: unknown[] } = {
    saveDryRunReport: [],
    snapshotBackup: [],
    finalizeExecute: [],
  };
  return {
    calls,
    saveDryRunReport: async (input: unknown) => {
      calls.saveDryRunReport.push(input);
      return "run-1";
    },
    snapshotBackup: async (runId: unknown) => {
      calls.snapshotBackup.push(runId);
      return "backups/run-1.dump";
    },
    finalizeExecute: async (input: unknown) => {
      calls.finalizeExecute.push(input);
    },
  };
}

test("dry run saves a catch_up migration_run report and never touches execute-only ports", async () => {
  const ports = fakePorts();
  const result = await runCatchUpDryRun({ contacts: [contactRow()], leads: [leadRow()] }, noExistingPersons, ports);

  assert.equal(result.migrationRunId, "run-1");
  assert.equal(result.report.rowsRead, 2);
  assert.equal(ports.calls.saveDryRunReport.length, 1);
  assert.equal(ports.calls.snapshotBackup.length, 0);
  assert.equal(ports.calls.finalizeExecute.length, 0);
});

test("execute refuses when the approved run's input hash is stale", async () => {
  const ports = fakePorts();
  await assert.rejects(
    () =>
      runCatchUpExecute(
        { contacts: [contactRow()], leads: [leadRow()] },
        noExistingPersons,
        approvedRun({ inputHash: "stale" }),
        ports,
      ),
    (err: unknown) => err instanceof MigrationExecutionBlockedError && err.reason === "stale_input_hash",
  );
  assert.equal(ports.calls.finalizeExecute.length, 0);
});

test("execute refuses a run of the wrong kind", async () => {
  const ports = fakePorts();
  const input = { contacts: [contactRow()], leads: [leadRow()] };
  const currentHash = computeCatchUpInputHash(input.contacts, input.leads, noExistingPersons);

  await assert.rejects(
    () =>
      runCatchUpExecute(
        input,
        noExistingPersons,
        approvedRun({ inputHash: currentHash, kind: "fold_leads" as never }),
        ports,
      ),
    (err: unknown) => err instanceof MigrationExecutionBlockedError && err.reason === "wrong_kind",
  );
  assert.equal(ports.calls.finalizeExecute.length, 0);
});

test("execute backs up, then finalizes into the approved run using the current input hash", async () => {
  const ports = fakePorts();
  const input = { contacts: [contactRow()], leads: [leadRow()] };
  const currentHash = computeCatchUpInputHash(input.contacts, input.leads, noExistingPersons);

  const result = await runCatchUpExecute(input, noExistingPersons, approvedRun({ inputHash: currentHash }), ports);

  assert.equal(result.migrationRunId, "run-1");
  assert.equal(ports.calls.snapshotBackup.length, 1);
  assert.equal(ports.calls.finalizeExecute.length, 1);
});

test("re-running with empty input reports zero rows (idempotent)", async () => {
  const ports = fakePorts();
  const result = await runCatchUpDryRun({ contacts: [], leads: [] }, noExistingPersons, ports);
  assert.equal(result.report.rowsRead, 0);
  assert.equal(result.report.leadsSkippedNoOwner, 0);
});
