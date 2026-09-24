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

test("allows execution when the run exists, is approved, and the hash matches", () => {
  assert.doesNotThrow(() =>
    assertExecutionAllowed({ approvedAt: new Date(), inputHash: "abc" }, "abc"),
  );
});

test("refuses when the run does not exist", () => {
  assert.throws(
    () => assertExecutionAllowed(null, "abc"),
    (err: unknown) =>
      err instanceof MigrationExecutionBlockedError && err.reason === "not_found",
  );
});

test("refuses when the run has not been approved", () => {
  assert.throws(
    () => assertExecutionAllowed({ approvedAt: null, inputHash: "abc" }, "abc"),
    (err: unknown) =>
      err instanceof MigrationExecutionBlockedError && err.reason === "not_approved",
  );
});

test("refuses when the input hash has changed since the dry run", () => {
  assert.throws(
    () => assertExecutionAllowed({ approvedAt: new Date(), inputHash: "abc" }, "def"),
    (err: unknown) =>
      err instanceof MigrationExecutionBlockedError && err.reason === "stale_input_hash",
  );
});
