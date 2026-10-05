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
