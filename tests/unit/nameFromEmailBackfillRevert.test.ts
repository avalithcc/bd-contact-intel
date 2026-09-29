/**
 * Unit tests for src/lib/identity/nameFromEmailBackfillRevert.ts. Pure, no
 * DB — run with: npx tsx --test tests/unit/nameFromEmailBackfillRevert.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNameFromEmailRevertPlan } from "@/lib/identity/nameFromEmailBackfillRevert";

test("a person whose current name still equals exactly what the backfill wrote is planned to revert", () => {
  const plan = buildNameFromEmailRevertPlan({
    auditedFills: [{ personId: "p1", firstName: "Efrain", lastName: "Romero" }],
    currentPersons: [{ id: "p1", firstName: "Efrain", lastName: "Romero" }],
    auditedDuplicateCandidates: [],
    currentDuplicateCandidates: [],
  });
  assert.deepEqual(plan.personIdsToRevert, ["p1"]);
  assert.deepEqual(plan.personsSkipped, []);
});

test("a person whose name changed since the backfill (BD correction) is skipped, not reverted", () => {
  const plan = buildNameFromEmailRevertPlan({
    auditedFills: [{ personId: "p1", firstName: "Efrain", lastName: "Romero" }],
    currentPersons: [{ id: "p1", firstName: "Efraín", lastName: "Romero" }],
    auditedDuplicateCandidates: [],
    currentDuplicateCandidates: [],
  });
  assert.deepEqual(plan.personIdsToRevert, []);
  assert.deepEqual(plan.personsSkipped, [{ personId: "p1", reason: "changed_since_backfill" }]);
});

test("a person only the first name changed is still skipped (both must match exactly)", () => {
  const plan = buildNameFromEmailRevertPlan({
    auditedFills: [{ personId: "p1", firstName: "Efrain", lastName: "Romero" }],
    currentPersons: [{ id: "p1", firstName: "Efrain", lastName: "Gomez" }],
    auditedDuplicateCandidates: [],
    currentDuplicateCandidates: [],
  });
  assert.deepEqual(plan.personIdsToRevert, []);
  assert.equal(plan.personsSkipped[0]!.reason, "changed_since_backfill");
});

test("a person no longer found (deleted/merged since) is skipped as not_found", () => {
  const plan = buildNameFromEmailRevertPlan({
    auditedFills: [{ personId: "p1", firstName: "Efrain", lastName: "Romero" }],
    currentPersons: [],
    auditedDuplicateCandidates: [],
    currentDuplicateCandidates: [],
  });
  assert.deepEqual(plan.personIdsToRevert, []);
  assert.deepEqual(plan.personsSkipped, [{ personId: "p1", reason: "not_found" }]);
});

test("a still-open queued duplicate_candidate is planned for deletion", () => {
  const plan = buildNameFromEmailRevertPlan({
    auditedFills: [],
    currentPersons: [],
    auditedDuplicateCandidates: [{ id: "dc1", personAId: "p1", personBId: "p2" }],
    currentDuplicateCandidates: [{ id: "dc1", status: "open" }],
  });
  assert.deepEqual(plan.duplicateCandidateIdsToDelete, ["dc1"]);
  assert.deepEqual(plan.duplicateCandidatesSkipped, []);
});

test("an already-reviewed (merged/not_duplicate) queued duplicate_candidate is left alone and reported", () => {
  const plan = buildNameFromEmailRevertPlan({
    auditedFills: [],
    currentPersons: [],
    auditedDuplicateCandidates: [
      { id: "dc1", personAId: "p1", personBId: "p2" },
      { id: "dc2", personAId: "p3", personBId: "p4" },
    ],
    currentDuplicateCandidates: [
      { id: "dc1", status: "not_duplicate" },
      { id: "dc2", status: "merged" },
    ],
  });
  assert.deepEqual(plan.duplicateCandidateIdsToDelete, []);
  assert.deepEqual(plan.duplicateCandidatesSkipped, [
    { id: "dc1", reason: "not_duplicate" },
    { id: "dc2", reason: "merged" },
  ]);
});

test("a queued duplicate_candidate no longer found (already deleted) is skipped as not_found", () => {
  const plan = buildNameFromEmailRevertPlan({
    auditedFills: [],
    currentPersons: [],
    auditedDuplicateCandidates: [{ id: "dc1", personAId: "p1", personBId: "p2" }],
    currentDuplicateCandidates: [],
  });
  assert.deepEqual(plan.duplicateCandidateIdsToDelete, []);
  assert.deepEqual(plan.duplicateCandidatesSkipped, [{ id: "dc1", reason: "not_found" }]);
});

test("buildNameFromEmailRevertPlan never mutates its inputs", () => {
  const input = {
    auditedFills: [{ personId: "p1", firstName: "Efrain", lastName: "Romero" }],
    currentPersons: [{ id: "p1", firstName: "Efrain", lastName: "Romero" }],
    auditedDuplicateCandidates: [{ id: "dc1", personAId: "p1", personBId: "p2" }],
    currentDuplicateCandidates: [{ id: "dc1", status: "open" }],
  };
  const before = JSON.parse(JSON.stringify(input));
  buildNameFromEmailRevertPlan(input);
  assert.deepEqual(input, before);
});

test("buildNameFromEmailRevertPlan called twice with the same input returns the same result", () => {
  const input = {
    auditedFills: [{ personId: "p1", firstName: "Efrain", lastName: "Romero" }],
    currentPersons: [{ id: "p1", firstName: "Efrain", lastName: "Romero" }],
    auditedDuplicateCandidates: [{ id: "dc1", personAId: "p1", personBId: "p2" }],
    currentDuplicateCandidates: [{ id: "dc1", status: "open" }],
  };
  const first = buildNameFromEmailRevertPlan(input);
  const second = buildNameFromEmailRevertPlan(input);
  assert.deepEqual(first, second);
});
