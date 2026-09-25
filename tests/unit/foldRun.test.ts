/**
 * Unit tests for src/lib/migration/foldRun.ts — mode-branching orchestration
 * around the fold-leads planner, mirroring collapseRun.ts's guarantees:
 * dry run never writes person rows; execute refuses on stale input_hash or
 * missing approval. No real DB — ports are hand-written fakes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { runFoldDryRun, runFoldExecute } from "@/lib/migration/foldRun";
import { MigrationExecutionBlockedError } from "@/lib/migration/executionGuard";
import { computeFoldInputHash } from "@/lib/migration/inputHash";
import type { FoldExistingPerson, FoldLeadRow } from "@/lib/migration/foldPlanner";

function person(): FoldExistingPerson {
  return {
    id: "person-1",
    profileKey: "linkedin.com/in/ana",
    firstName: "Ana",
    lastName: "Pereyra",
    companyKey: "acme",
    email: "ana@acme.com",
    emailNormalized: "ana@acme.com",
    emailStatus: "verified",
    emailConfidence: 90,
    emailSource: "linkedin_export",
    jobTitle: "CTO",
    industry: null,
  };
}

function lead(): FoldLeadRow {
  return {
    id: "lead-1",
    ownerBdId: "bd-1",
    firstName: "Carla",
    lastName: "Diaz",
    company: "Other Co",
    companyKey: "other",
    jobTitle: null,
    industry: null,
    email: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    sourceKey: "fi-arg-2026",
    status: "new",
    updatedByBdId: null,
    updatedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const noActivityTypes: ReadonlyMap<string, ReadonlySet<string>> = new Map();

function approvedRun(overrides: Partial<Parameters<typeof runFoldExecute>[3]> = {}) {
  return {
    id: "run-1",
    kind: "fold_leads" as const,
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

test("dry run saves a fold_leads migration_run report and never touches execute-only ports", async () => {
  const ports = fakePorts();
  const result = await runFoldDryRun([person()], [lead()], noActivityTypes, ports);

  assert.equal(result.migrationRunId, "run-1");
  assert.equal(ports.calls.saveDryRunReport.length, 1);
  assert.equal(ports.calls.snapshotBackup.length, 0);
  assert.equal(ports.calls.finalizeExecute.length, 0);
});

test("execute refuses when the approved run's input hash is stale", async () => {
  const ports = fakePorts();
  await assert.rejects(
    () => runFoldExecute([person()], [lead()], noActivityTypes, approvedRun({ inputHash: "stale" }), ports),
    (err: unknown) => err instanceof MigrationExecutionBlockedError && err.reason === "stale_input_hash",
  );
  assert.equal(ports.calls.finalizeExecute.length, 0);
});

test("execute backs up, then finalizes into the approved run using the current input hash", async () => {
  const ports = fakePorts();
  const persons = [person()];
  const leads = [lead()];
  const currentHash = computeFoldInputHash(leads, persons, noActivityTypes);

  const result = await runFoldExecute(persons, leads, noActivityTypes, approvedRun({ inputHash: currentHash }), ports);

  assert.equal(result.migrationRunId, "run-1");
  assert.equal(ports.calls.snapshotBackup.length, 1);
  assert.equal(ports.calls.finalizeExecute.length, 1);
});

test("execute refuses with stale_input_hash when only activity types changed since the dry run", async () => {
  const ports = fakePorts();
  const persons = [person()];
  const leads = [lead()];
  // Approved against the dry-run hash computed with NO activity types...
  const dryRunHash = computeFoldInputHash(leads, persons, noActivityTypes);
  // ...but by execute time, an activity was logged for the lead — the
  // planner's "no supporting activity" check now sees different input than
  // the owner reviewed, so this must be refused, not silently executed.
  const changedActivityTypes = new Map([["lead-1", new Set(["email_sent"])]]);

  await assert.rejects(
    () =>
      runFoldExecute(persons, leads, changedActivityTypes, approvedRun({ inputHash: dryRunHash }), ports),
    (err: unknown) => err instanceof MigrationExecutionBlockedError && err.reason === "stale_input_hash",
  );
  assert.equal(ports.calls.finalizeExecute.length, 0);
});
