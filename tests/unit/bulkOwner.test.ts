/**
 * Unit tests for src/lib/contacts/bulkOwner.ts (task 13.2, bulk "Asignar
 * responsable"): the pure id/value helpers. A manual reassignment is never
 * gated on connections any more (see ownerRule.ts), so there is no planner.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BULK_FILTER_TARGET_CAP,
  MAX_BULK_SELECTION,
  normalizeOwnerSelectValue,
  planOwnerAssignment,
  sanitizeBulkPersonIds,
} from "@/lib/contacts/bulkOwner";

test("sanitizeBulkPersonIds keeps only valid uuids, dedups, and caps at MAX_BULK_SELECTION", () => {
  const uuid1 = "11111111-1111-4111-8111-111111111111";
  const uuid2 = "22222222-2222-4222-8222-222222222222";
  const result = sanitizeBulkPersonIds([uuid1, "not-a-uuid", uuid1, uuid2]);
  assert.deepEqual(result, [uuid1, uuid2]);
});

test("sanitizeBulkPersonIds caps the selection at MAX_BULK_SELECTION", () => {
  const many = Array.from({ length: MAX_BULK_SELECTION + 10 }, (_, i) => {
    const hex = i.toString(16).padStart(8, "0");
    return `11111111-1111-4111-8111-${hex}0000`;
  });
  const result = sanitizeBulkPersonIds(many);
  assert.equal(result.length, MAX_BULK_SELECTION);
});

test("sanitizeBulkPersonIds accepts an explicit higher cap ('Seleccionar los N' filter-wide mode: BULK_FILTER_TARGET_CAP, not MAX_BULK_SELECTION)", () => {
  const many = Array.from({ length: BULK_FILTER_TARGET_CAP + 10 }, (_, i) => {
    const hex = i.toString(16).padStart(8, "0");
    return `11111111-1111-4111-8111-${hex}0000`;
  });
  assert.equal(sanitizeBulkPersonIds(many).length, MAX_BULK_SELECTION);
  assert.equal(sanitizeBulkPersonIds(many, BULK_FILTER_TARGET_CAP).length, BULK_FILTER_TARGET_CAP);
});

test("normalizeOwnerSelectValue maps a blank <select> value to null (unassign), a uuid to itself, and rejects garbage", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  assert.equal(normalizeOwnerSelectValue(""), null);
  assert.equal(normalizeOwnerSelectValue(uuid), uuid);
  assert.equal(normalizeOwnerSelectValue("not-a-uuid"), undefined);
});

test("planOwnerAssignment: confirming the current owner writes the manual marker but no row update", () => {
  const plan = planOwnerAssignment([{ id: "p1", ownerBdId: "bd-a" }], "bd-a", new Set());
  assert.deepEqual(plan, { toUpdate: [], history: [{ personId: "p1", oldValue: "bd-a" }] });
});

test("planOwnerAssignment: a change updates the row and records the old owner", () => {
  const plan = planOwnerAssignment([{ id: "p1", ownerBdId: "bd-a" }, { id: "p2", ownerBdId: null }], "bd-b", new Set());
  assert.deepEqual(plan.toUpdate, ["p1", "p2"]);
  assert.deepEqual(plan.history, [{ personId: "p1", oldValue: "bd-a" }, { personId: "p2", oldValue: null }]);
});

test("planOwnerAssignment: re-confirming an already-marked owner writes nothing", () => {
  const plan = planOwnerAssignment([{ id: "p1", ownerBdId: "bd-a" }], "bd-a", new Set(["p1"]));
  assert.deepEqual(plan, { toUpdate: [], history: [] });
});

test("planOwnerAssignment: unassigning is a change like any other and does not mutate input", () => {
  const rows = [{ id: "p1", ownerBdId: "bd-a" }];
  const before = JSON.stringify(rows);
  assert.deepEqual(planOwnerAssignment(rows, null, new Set()), planOwnerAssignment(rows, null, new Set()));
  assert.deepEqual(planOwnerAssignment(rows, null, new Set()).toUpdate, ["p1"]);
  assert.equal(JSON.stringify(rows), before);
});
