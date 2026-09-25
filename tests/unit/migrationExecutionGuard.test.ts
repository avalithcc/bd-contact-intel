/**
 * Unit tests for src/lib/migration/executionGuard.ts — the R10/R13 owner
 * gate for `--execute --run=<id>` (contact-migration spec: "Dry-run blocks
 * production execution until reviewed"). Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertExecutionAllowed,
  MigrationExecutionBlockedError,
} from "@/lib/migration/executionGuard";

test("allows execution when the run exists, is approved, unexecuted, and the hash matches", () => {
  assert.doesNotThrow(() =>
    assertExecutionAllowed(
      { kind: "collapse", approvedAt: new Date(), executedAt: null, inputHash: "abc" },
      "abc",
      "collapse",
    ),
  );
});

test("refuses when the run does not exist", () => {
  assert.throws(
    () => assertExecutionAllowed(null, "abc", "collapse"),
    (err: unknown) =>
      err instanceof MigrationExecutionBlockedError && err.reason === "not_found",
  );
});

test("refuses when the run has not been approved", () => {
  assert.throws(
    () =>
      assertExecutionAllowed(
        { kind: "collapse", approvedAt: null, executedAt: null, inputHash: "abc" },
        "abc",
        "collapse",
      ),
    (err: unknown) =>
      err instanceof MigrationExecutionBlockedError && err.reason === "not_approved",
  );
});

test("refuses when the input hash has changed since the dry run", () => {
  assert.throws(
    () =>
      assertExecutionAllowed(
        { kind: "collapse", approvedAt: new Date(), executedAt: null, inputHash: "abc" },
        "def",
        "collapse",
      ),
    (err: unknown) =>
      err instanceof MigrationExecutionBlockedError && err.reason === "stale_input_hash",
  );
});

test("refuses when the run has already been executed, before checking the hash", () => {
  assert.throws(
    () =>
      assertExecutionAllowed(
        { kind: "collapse", approvedAt: new Date(), executedAt: new Date(), inputHash: "abc" },
        // Even a matching hash must not let a second --execute slip through
        // as a silent no-op or a constraint violation on the DB writes.
        "abc",
        "collapse",
      ),
    (err: unknown) =>
      err instanceof MigrationExecutionBlockedError && err.reason === "already_executed",
  );
});

test("refuses --phase=fold_leads --execute --run=<id> when the run is a collapse run, before checking the hash", () => {
  assert.throws(
    () =>
      assertExecutionAllowed(
        { kind: "collapse", approvedAt: new Date(), executedAt: null, inputHash: "abc" },
        // A matching hash must not let a fold_leads execute run against a
        // collapse dry run slip through — a coincidental hash match is not
        // proof the run was reviewed for the right phase.
        "abc",
        "fold_leads",
      ),
    (err: unknown) => err instanceof MigrationExecutionBlockedError && err.reason === "wrong_kind",
  );
});

test("refuses --phase=collapse --execute --run=<id> when the run is a fold_leads run, before checking the hash", () => {
  assert.throws(
    () =>
      assertExecutionAllowed(
        { kind: "fold_leads", approvedAt: new Date(), executedAt: null, inputHash: "abc" },
        "abc",
        "collapse",
      ),
    (err: unknown) => err instanceof MigrationExecutionBlockedError && err.reason === "wrong_kind",
  );
});
