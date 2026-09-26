/**
 * Unit tests for src/lib/contacts/manualSignal.ts — pure planner behind the
 * "Pegar señal" quick action (task 11.6; ports the legacy `/leads/[id]` and
 * `/contact/[id]` "+ Paste signal" composer, `src/app/ManualSignal.tsx`,
 * onto the unified Contact record — feature-parity gap flagged in PR 11c).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ManualSignalTextRequiredError, planManualSignal } from "@/lib/contacts/manualSignal";

test("missing text is rejected", () => {
  assert.throws(() => planManualSignal(""), ManualSignalTextRequiredError);
});

test("blank text is rejected", () => {
  assert.throws(() => planManualSignal("   "), ManualSignalTextRequiredError);
});

test("text is trimmed", () => {
  const plan = planManualSignal("  Mercado Libre opened 6 new roles this week  ");
  assert.deepEqual(plan, { text: "Mercado Libre opened 6 new roles this week" });
});
