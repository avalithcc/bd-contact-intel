/** Unit tests for the pure planner behind scripts/backfill-owner-last-worked.ts. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planOwnerBackfill } from "@/lib/identity/ownerBackfillPlan";

const d = (iso: string) => new Date(iso);

function input() {
  return {
    persons: [
      { id: "p-change", ownerBdId: "bd-a" },
      { id: "p-same", ownerBdId: "bd-b" },
      { id: "p-manual", ownerBdId: "bd-a" },
      { id: "p-undecided", ownerBdId: "bd-a" },
      { id: "p-fallback", ownerBdId: "bd-b" },
    ],
    connections: [
      { personId: "p-change", bdId: "bd-a", connectedOn: "1 Jan 2020", lastMessageAt: d("2024-01-01T00:00:00Z") },
      { personId: "p-change", bdId: "bd-b", connectedOn: "1 Jan 2022", lastMessageAt: d("2024-05-01T00:00:00Z") },
      { personId: "p-same", bdId: "bd-b", connectedOn: "1 Jan 2020", lastMessageAt: d("2024-05-01T00:00:00Z") },
      { personId: "p-manual", bdId: "bd-b", connectedOn: "1 Jan 2020", lastMessageAt: d("2025-05-01T00:00:00Z") },
      { personId: "p-fallback", bdId: "bd-a", connectedOn: "1 Jan 2019", lastMessageAt: null },
      { personId: "p-fallback", bdId: "bd-b", connectedOn: "1 Jan 2021", lastMessageAt: null },
    ],
    touches: [{ personId: "p-same", bdId: "bd-b", at: d("2024-06-01T00:00:00Z") }],
    manualPersonIds: new Set(["p-manual"]),
  };
}

test("planOwnerBackfill classifies changed, unchanged, manual and undecided persons", () => {
  const plan = planOwnerBackfill(input());
  assert.deepEqual(
    plan.changes.map((c) => ({ id: c.personId, from: c.fromBdId, to: c.toBdId, basis: c.basis })),
    [
      { id: "p-change", from: "bd-a", to: "bd-b", basis: "last_touch" },
      { id: "p-fallback", from: "bd-b", to: "bd-a", basis: "earliest_connection" },
    ],
  );
  assert.equal(plan.skippedManual, 1);
  assert.equal(plan.unchanged, 2); // p-same (already right) + p-undecided (nothing to decide on)
});

test("planOwnerBackfill never mutates its input and is repeatable", () => {
  const data = input();
  const snapshot = JSON.stringify({ ...data, manualPersonIds: [...data.manualPersonIds] });
  const first = planOwnerBackfill(data);
  const second = planOwnerBackfill(data);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ ...data, manualPersonIds: [...data.manualPersonIds] }), snapshot);
});
