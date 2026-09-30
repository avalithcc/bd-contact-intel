/**
 * Unit tests for src/lib/identity/stuffedNameSplitBackfillRevert.ts. Pure, no
 * DB — run with: npx tsx --test tests/unit/stuffedNameSplitBackfillRevert.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStuffedNameSplitRevertPlan,
  selectStuffedNameSplitAuditRow,
  type StuffedNameSplitAuditRowForSelection,
} from "@/lib/identity/stuffedNameSplitBackfillRevert";

function auditedFill(overrides: Partial<{
  personId: string;
  firstName: string | null;
  lastName: string | null;
  originalFirstName: string;
  originalLastName: string | null;
}> = {}) {
  return {
    personId: "p1",
    firstName: "Leon",
    lastName: "Sacks",
    originalFirstName: "Leon Sacks",
    originalLastName: null,
    ...overrides,
  };
}

test("a person whose current name still equals exactly what the backfill wrote is planned to revert to the original stuffed value", () => {
  const plan = buildStuffedNameSplitRevertPlan({
    auditedFills: [auditedFill()],
    currentPersons: [{ id: "p1", firstName: "Leon", lastName: "Sacks" }],
  });
  assert.deepEqual(plan.toRevert, [{ personId: "p1", originalFirstName: "Leon Sacks", originalLastName: null }]);
  assert.deepEqual(plan.skipped, []);
});

test("a person whose name changed since the backfill (BD correction) is skipped, not reverted", () => {
  const plan = buildStuffedNameSplitRevertPlan({
    auditedFills: [auditedFill()],
    currentPersons: [{ id: "p1", firstName: "Leon", lastName: "Sacks-Corrected" }],
  });
  assert.deepEqual(plan.toRevert, []);
  assert.deepEqual(plan.skipped, [{ personId: "p1", reason: "changed_since_backfill" }]);
});

test("a person only the first name changed is still skipped (both must match exactly)", () => {
  const plan = buildStuffedNameSplitRevertPlan({
    auditedFills: [auditedFill()],
    currentPersons: [{ id: "p1", firstName: "Leo", lastName: "Sacks" }],
  });
  assert.deepEqual(plan.toRevert, []);
  assert.equal(plan.skipped[0]!.reason, "changed_since_backfill");
});

test("a person no longer found (deleted/merged since) is skipped as not_found", () => {
  const plan = buildStuffedNameSplitRevertPlan({
    auditedFills: [auditedFill()],
    currentPersons: [],
  });
  assert.deepEqual(plan.toRevert, []);
  assert.deepEqual(plan.skipped, [{ personId: "p1", reason: "not_found" }]);
});

test("preserves the exact original last_name (null vs empty string) so revert restores the pre-backfill state exactly", () => {
  const plan = buildStuffedNameSplitRevertPlan({
    auditedFills: [auditedFill({ personId: "p2", originalLastName: "" })],
    currentPersons: [{ id: "p2", firstName: "Leon", lastName: "Sacks" }],
  });
  assert.deepEqual(plan.toRevert, [{ personId: "p2", originalFirstName: "Leon Sacks", originalLastName: "" }]);
});

test("buildStuffedNameSplitRevertPlan never mutates its inputs", () => {
  const input = {
    auditedFills: [auditedFill()],
    currentPersons: [{ id: "p1", firstName: "Leon", lastName: "Sacks" }],
  };
  const before = JSON.parse(JSON.stringify(input));
  buildStuffedNameSplitRevertPlan(input);
  assert.deepEqual(input, before);
});

test("buildStuffedNameSplitRevertPlan called twice with the same input returns the same result", () => {
  const input = {
    auditedFills: [auditedFill()],
    currentPersons: [{ id: "p1", firstName: "Leon", lastName: "Sacks" }],
  };
  const first = buildStuffedNameSplitRevertPlan(input);
  const second = buildStuffedNameSplitRevertPlan(input);
  assert.deepEqual(first, second);
});

test("never touches a person not listed in the audited fills, even if currentPersons carries extra rows", () => {
  const plan = buildStuffedNameSplitRevertPlan({
    auditedFills: [auditedFill({ personId: "p1" })],
    currentPersons: [
      { id: "p1", firstName: "Leon", lastName: "Sacks" },
      { id: "p2", firstName: "Someone", lastName: "Else" },
    ],
  });
  assert.deepEqual(plan.toRevert.map((r) => r.personId), ["p1"]);
});

// --- nullable firstName/lastName (first-token backfill's manual overrides) --

test("a manual override that wrote a NULL first_name still reverts when the current row still equals exactly what was written", () => {
  const plan = buildStuffedNameSplitRevertPlan({
    auditedFills: [
      auditedFill({ personId: "p1", firstName: null, lastName: "Ciotta", originalFirstName: "Contacto de 2º grado2º V" }),
    ],
    currentPersons: [{ id: "p1", firstName: null, lastName: "Ciotta" }],
  });
  assert.deepEqual(plan.toRevert, [
    { personId: "p1", originalFirstName: "Contacto de 2º grado2º V", originalLastName: null },
  ]);
  assert.deepEqual(plan.skipped, []);
});

test("a NULL-written first_name that a BD later filled in is skipped, not reverted", () => {
  const plan = buildStuffedNameSplitRevertPlan({
    auditedFills: [auditedFill({ personId: "p1", firstName: null, lastName: "Ciotta" })],
    currentPersons: [{ id: "p1", firstName: "Gabriel", lastName: "Ciotta" }],
  });
  assert.deepEqual(plan.toRevert, []);
  assert.deepEqual(plan.skipped, [{ personId: "p1", reason: "changed_since_backfill" }]);
});

// --- selectStuffedNameSplitAuditRow ------------------------------------------
// Same CRITICAL fix as nameFromEmailBackfillRevert: never just "latest".

function auditRow(overrides: Partial<StuffedNameSplitAuditRowForSelection> = {}): StuffedNameSplitAuditRowForSelection {
  return {
    id: "audit-1",
    at: new Date("2026-09-29T00:00:00.000Z"),
    actorBdId: "bd-1",
    fills: [auditedFill()],
    ...overrides,
  };
}

test("selectStuffedNameSplitAuditRow returns none when there are no rows at all", () => {
  assert.deepEqual(selectStuffedNameSplitAuditRow([], null), { kind: "none" });
});

test("selectStuffedNameSplitAuditRow ignores empty (legacy/defensive) rows", () => {
  const empty = auditRow({ id: "audit-empty", fills: [] });
  assert.deepEqual(selectStuffedNameSplitAuditRow([empty], null), { kind: "none" });
});

test("selectStuffedNameSplitAuditRow auto-selects the single non-empty row, skipping empty ones", () => {
  const real = auditRow({ id: "audit-real" });
  const empty = auditRow({ id: "audit-empty", fills: [] });
  const selection = selectStuffedNameSplitAuditRow([empty, real], null);
  assert.equal(selection.kind, "selected");
  assert.equal(selection.kind === "selected" ? selection.row.id : null, "audit-real");
});

test("selectStuffedNameSplitAuditRow refuses when several non-empty rows exist and no --audit-id was given", () => {
  const first = auditRow({ id: "audit-1" });
  const second = auditRow({ id: "audit-2" });
  const selection = selectStuffedNameSplitAuditRow([first, second], null);
  assert.equal(selection.kind, "ambiguous");
  if (selection.kind === "ambiguous") {
    assert.deepEqual(selection.candidates.map((c) => c.id).sort(), ["audit-1", "audit-2"]);
  }
});

test("selectStuffedNameSplitAuditRow selects the row matching an explicit --audit-id", () => {
  const first = auditRow({ id: "audit-1" });
  const second = auditRow({ id: "audit-2" });
  const selection = selectStuffedNameSplitAuditRow([first, second], "audit-2");
  assert.deepEqual(selection, { kind: "selected", row: second });
});

test("selectStuffedNameSplitAuditRow reports not_found for an --audit-id that doesn't match any non-empty row", () => {
  const first = auditRow({ id: "audit-1" });
  const selection = selectStuffedNameSplitAuditRow([first], "nonexistent");
  assert.equal(selection.kind, "not_found");
  if (selection.kind === "not_found") {
    assert.equal(selection.requestedAuditId, "nonexistent");
    assert.deepEqual(selection.candidates.map((c) => c.id), ["audit-1"]);
  }
});
