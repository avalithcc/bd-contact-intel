/**
 * Unit tests for src/lib/contacts/bulkOwner.ts (task 13.2, bulk "Asignar
 * responsable"). Pure planner — no DB. Mirrors the same R3 rule as
 * updateLeadOwner (src/lib/leads/queries.ts): a person's owner is only
 * reassigned when they have no `person_bd_connection` row yet. The bulk
 * version reports a per-row outcome instead of silently no-op'ing skipped
 * rows (orchestrator instruction: "report per-row outcome").
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_BULK_SELECTION,
  normalizeOwnerSelectValue,
  planBulkOwnerAssignment,
  sanitizeBulkPersonIds,
} from "@/lib/contacts/bulkOwner";

test("planBulkOwnerAssignment assigns rows with no existing connection", () => {
  const result = planBulkOwnerAssignment([
    { personId: "p1", hasConnection: false },
    { personId: "p2", hasConnection: false },
  ]);
  assert.deepEqual(result, [
    { personId: "p1", outcome: "assigned" },
    { personId: "p2", outcome: "assigned" },
  ]);
});

test("planBulkOwnerAssignment skips rows that already have a connection (R3)", () => {
  const result = planBulkOwnerAssignment([
    { personId: "p1", hasConnection: true },
    { personId: "p2", hasConnection: false },
  ]);
  assert.deepEqual(result, [
    { personId: "p1", outcome: "skipped_has_connection" },
    { personId: "p2", outcome: "assigned" },
  ]);
});

test("planBulkOwnerAssignment returns an empty plan for an empty selection", () => {
  assert.deepEqual(planBulkOwnerAssignment([]), []);
});

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

test("normalizeOwnerSelectValue maps a blank <select> value to null (unassign), a uuid to itself, and rejects garbage", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  assert.equal(normalizeOwnerSelectValue(""), null);
  assert.equal(normalizeOwnerSelectValue(uuid), uuid);
  assert.equal(normalizeOwnerSelectValue("not-a-uuid"), undefined);
});
