/**
 * Unit tests for src/lib/migration/hubspotRun.ts (design D6, task 4.2/4.9).
 * Pure — ports are stubbed, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { runHubSpotImportDryRun, runHubSpotImportExecute } from "@/lib/migration/hubspotRun";
import { MigrationExecutionBlockedError } from "@/lib/migration/executionGuard";
import type { HubSpotContactRow } from "@/lib/hubspot/contacts";
import type { PlanHubSpotImportInput } from "@/lib/hubspot/planner";

function contact(id: string, overrides: Partial<HubSpotContactRow> = {}): HubSpotContactRow {
  return {
    hubspotContactId: id,
    firstName: "Jane",
    lastName: "Doe",
    email: `jane${id}@acme.com`,
    jobTitle: null,
    city: null,
    country: null,
    phone: null,
    linkedinUrl: null,
    ownerRaw: null,
    timesContacted: 0,
    lastContactAt: null,
    lastActivityAt: null,
    createdAt: null,
    leadStatus: null,
    associatedCompanyIdPrimary: null,
    associatedCompanyIdPrimaryMultiple: false,
    ...overrides,
  };
}

function baseInput(overrides: Partial<PlanHubSpotImportInput> = {}): PlanHubSpotImportInput {
  return {
    contacts: [contact("1")],
    companies: [],
    existingCompanies: [],
    existingNoteHubspotCompanyIds: new Set(),
    bds: [],
    existingHubspotPersonIds: new Map(),
    existingPersonsForRefill: new Map(),
    identityIndex: [],
    migrationRunId: null,
    runAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

test("dry run never touches person/company write ports — only saveDryRunReport", async () => {
  let saved: unknown;
  const result = await runHubSpotImportDryRun(baseInput(), "hash-1", {
    saveDryRunReport: async (input) => {
      saved = input;
      return "run-1";
    },
  });
  assert.equal(result.migrationRunId, "run-1");
  assert.equal(result.report.rowsRead, 1);
  assert.ok(saved);
});

test("execute refuses when the run is not approved, before ever calling snapshotBackup", async () => {
  let backupCalled = false;
  await assert.rejects(
    () =>
      runHubSpotImportExecute(baseInput(), "hash-1", null, {
        snapshotBackup: async () => {
          backupCalled = true;
          return "backups/x.dump";
        },
        finalizeExecute: async () => {},
      }),
    (err: unknown) => err instanceof MigrationExecutionBlockedError && err.reason === "not_found",
  );
  assert.equal(backupCalled, false);
});

test("execute refuses on a stale input hash", async () => {
  await assert.rejects(
    () =>
      runHubSpotImportExecute(
        baseInput(),
        "hash-current",
        {
          id: "run-1",
          kind: "hubspot_import",
          approvedAt: new Date(),
          executedAt: null,
          inputHash: "hash-stale",
          approvedByBdId: "bd-1",
        },
        { snapshotBackup: async () => "backups/x.dump", finalizeExecute: async () => {} },
      ),
    (err: unknown) => err instanceof MigrationExecutionBlockedError && err.reason === "stale_input_hash",
  );
});

test("execute refuses an unconfirmed over-threshold review count, even with a matching hash and approval", async () => {
  await assert.rejects(
    () =>
      runHubSpotImportExecute(
        baseInput(),
        "hash-1",
        {
          id: "run-1",
          kind: "hubspot_import",
          approvedAt: new Date(),
          executedAt: null,
          inputHash: "hash-1",
          approvedByBdId: "bd-1",
          reviewCount: 301,
        },
        { snapshotBackup: async () => "backups/x.dump", finalizeExecute: async () => {} },
      ),
    (err: unknown) =>
      err instanceof MigrationExecutionBlockedError && err.reason === "review_threshold_unconfirmed",
  );
});

test("execute backs up, finalizes, and returns the report when approved, hash matches, and threshold is confirmed", async () => {
  const finalizeCalls: unknown[] = [];
  const result = await runHubSpotImportExecute(
    baseInput(),
    "hash-1",
    {
      id: "run-1",
      kind: "hubspot_import",
      approvedAt: new Date(),
      executedAt: null,
      inputHash: "hash-1",
      approvedByBdId: "bd-1",
      reviewCount: 301,
      reviewThresholdConfirmed: true,
    },
    {
      snapshotBackup: async (runId) => `backups/${runId}.dump`,
      finalizeExecute: async (input) => {
        finalizeCalls.push(input);
      },
    },
  );
  assert.equal(result.migrationRunId, "run-1");
  assert.equal(finalizeCalls.length, 1);
  assert.equal((finalizeCalls[0] as { backupPath: string }).backupPath, "backups/run-1.dump");
});

// --- idempotent re-import (task 4.13; hubspot-import spec "idempotent
// re-import requirement") --------------------------------------------------

test("re-running the dry-run after every contact is already_imported reports 0 new", async () => {
  const input = baseInput({
    contacts: [contact("1"), contact("2")],
    existingHubspotPersonIds: new Map([
      ["1", "person-1"],
      ["2", "person-2"],
    ]),
  });
  const result = await runHubSpotImportDryRun(input, "hash-1", {
    saveDryRunReport: async () => "run-2",
  });
  assert.equal(result.report.outcomes.new, 0);
  assert.equal(result.report.outcomes.already_imported, 2);
});
