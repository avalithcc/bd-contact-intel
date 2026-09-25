/**
 * Unit tests for src/lib/migration/approveGuard.ts — the "Approve dry run"
 * gate (design.md "Migration plan" step 2; fresh-review WARNING:
 * approveMigrationRun approved any runId unconditionally). Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertApprovable, MigrationApproveBlockedError } from "@/lib/migration/approveGuard";

function run(overrides: Partial<Parameters<typeof assertApprovable>[0]> = {}) {
  return {
    id: "run-1",
    kind: "collapse" as const,
    approvedAt: null,
    executedAt: null,
    ...overrides,
  };
}

test("allows approval when the run exists, matches kind, is unapproved/unexecuted, and is the latest of its kind", () => {
  assert.doesNotThrow(() => assertApprovable(run(), "collapse", "run-1"));
});

test("refuses when the run does not exist", () => {
  assert.throws(
    () => assertApprovable(null, "collapse", "run-1"),
    (err: unknown) => err instanceof MigrationApproveBlockedError && err.reason === "not_found",
  );
});

test("refuses when the run's kind does not match the submitting section/form", () => {
  assert.throws(
    () => assertApprovable(run({ kind: "fold_leads" }), "collapse", "run-1"),
    (err: unknown) => err instanceof MigrationApproveBlockedError && err.reason === "wrong_kind",
  );
});

test("refuses when the run has already been executed", () => {
  assert.throws(
    () => assertApprovable(run({ executedAt: new Date() }), "collapse", "run-1"),
    (err: unknown) => err instanceof MigrationApproveBlockedError && err.reason === "already_executed",
  );
});

test("refuses when the run has already been approved", () => {
  assert.throws(
    () => assertApprovable(run({ approvedAt: new Date() }), "collapse", "run-1"),
    (err: unknown) => err instanceof MigrationApproveBlockedError && err.reason === "already_approved",
  );
});

test("refuses when the run is not the latest dry run of its kind (a newer run has superseded it)", () => {
  assert.throws(
    () => assertApprovable(run({ id: "run-old" }), "collapse", "run-new"),
    (err: unknown) => err instanceof MigrationApproveBlockedError && err.reason === "not_latest_dry_run",
  );
});
