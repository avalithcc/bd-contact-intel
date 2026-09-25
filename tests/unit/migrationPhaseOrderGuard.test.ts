/**
 * Unit tests for src/lib/migration/phaseOrderGuard.ts — the required-order
 * gate for `--phase=catch_up` (design.md "Catch-up (owner D4b)": required
 * order is collapse execute → fold_leads execute → catch_up). Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCatchUpPhaseOrderAllowed,
  PhaseOrderBlockedError,
} from "@/lib/migration/phaseOrderGuard";

test("allows catch_up when collapse and fold_leads have both executed", () => {
  assert.doesNotThrow(() =>
    assertCatchUpPhaseOrderAllowed(
      { executedAt: new Date() },
      { executedAt: new Date() },
    ),
  );
});

test("refuses catch_up when collapse has never run", () => {
  assert.throws(
    () => assertCatchUpPhaseOrderAllowed(null, { executedAt: new Date() }),
    (err: unknown) =>
      err instanceof PhaseOrderBlockedError && err.reason === "collapse_not_executed",
  );
});

test("refuses catch_up when collapse only ran as a dry run (never executed)", () => {
  assert.throws(
    () =>
      assertCatchUpPhaseOrderAllowed({ executedAt: null }, { executedAt: new Date() }),
    (err: unknown) =>
      err instanceof PhaseOrderBlockedError && err.reason === "collapse_not_executed",
  );
});

test("refuses catch_up when fold_leads has never executed, before any lead was folded", () => {
  assert.throws(
    () => assertCatchUpPhaseOrderAllowed({ executedAt: new Date() }, null),
    (err: unknown) =>
      err instanceof PhaseOrderBlockedError && err.reason === "fold_leads_not_executed",
  );
});

test("checks collapse before fold_leads when both are missing", () => {
  assert.throws(
    () => assertCatchUpPhaseOrderAllowed(null, null),
    (err: unknown) =>
      err instanceof PhaseOrderBlockedError && err.reason === "collapse_not_executed",
  );
});

test("error message names the missing phase clearly", () => {
  try {
    assertCatchUpPhaseOrderAllowed(null, { executedAt: new Date() });
    assert.fail("expected assertCatchUpPhaseOrderAllowed to throw");
  } catch (err) {
    assert.ok(err instanceof PhaseOrderBlockedError);
    assert.match(err.message, /collapse/i);
    assert.match(err.message, /execut/i);
  }
});
