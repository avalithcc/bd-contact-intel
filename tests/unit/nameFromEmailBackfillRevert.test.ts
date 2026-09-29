/**
 * Unit tests for src/lib/identity/nameFromEmailBackfillRevert.ts. Pure, no
 * DB — run with: npx tsx --test tests/unit/nameFromEmailBackfillRevert.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNameFromEmailRevertPlan,
  selectNameFromEmailBackfillAuditRow,
  type NameFromEmailBackfillAuditRowForSelection,
} from "@/lib/identity/nameFromEmailBackfillRevert";

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

test("buildNameFromEmailRevertPlan never touches a person or duplicate_candidate not listed in the audited input, even if currentPersons/currentDuplicateCandidates carry extra rows for other ids", () => {
  const plan = buildNameFromEmailRevertPlan({
    auditedFills: [{ personId: "p1", firstName: "Efrain", lastName: "Romero" }],
    // p2 is NOT in auditedFills — e.g. currentPersons was read too broadly.
    currentPersons: [
      { id: "p1", firstName: "Efrain", lastName: "Romero" },
      { id: "p2", firstName: "Someone", lastName: "Else" },
    ],
    auditedDuplicateCandidates: [{ id: "dc1", personAId: "p1", personBId: "p3" }],
    // dc2 is NOT in auditedDuplicateCandidates.
    currentDuplicateCandidates: [
      { id: "dc1", status: "open" },
      { id: "dc2", status: "open" },
    ],
  });
  assert.deepEqual(plan.personIdsToRevert, ["p1"]);
  assert.ok(!plan.personIdsToRevert.includes("p2"));
  assert.deepEqual(plan.duplicateCandidateIdsToDelete, ["dc1"]);
  assert.ok(!plan.duplicateCandidateIdsToDelete.includes("dc2"));
});

// --- selectNameFromEmailBackfillAuditRow ------------------------------------
// CRITICAL fix: revert must never depend on "latest" — a defensive/legacy
// empty row, or more than one non-empty row, must never be silently picked.

function auditRow(
  overrides: Partial<NameFromEmailBackfillAuditRowForSelection> = {},
): NameFromEmailBackfillAuditRowForSelection {
  return {
    id: "audit-1",
    at: new Date("2026-09-29T00:00:00.000Z"),
    actorBdId: "bd-1",
    fills: [{ personId: "p1", firstName: "Efrain", lastName: "Romero" }],
    duplicateCandidatesQueued: [],
    ...overrides,
  };
}

test("selectNameFromEmailBackfillAuditRow returns none when there are no rows at all", () => {
  assert.deepEqual(selectNameFromEmailBackfillAuditRow([], null), { kind: "none" });
});

test("selectNameFromEmailBackfillAuditRow ignores empty (legacy/defensive) rows and returns none if that's all there is", () => {
  const empty = auditRow({ id: "audit-empty", fills: [], duplicateCandidatesQueued: [] });
  assert.deepEqual(selectNameFromEmailBackfillAuditRow([empty], null), { kind: "none" });
});

test("selectNameFromEmailBackfillAuditRow auto-selects the single non-empty row, skipping empty ones", () => {
  const real = auditRow({ id: "audit-real" });
  const empty = auditRow({ id: "audit-empty", fills: [], duplicateCandidatesQueued: [] });
  const selection = selectNameFromEmailBackfillAuditRow([empty, real], null);
  assert.equal(selection.kind, "selected");
  assert.equal(selection.kind === "selected" ? selection.row.id : null, "audit-real");
});

test("a row queuing only duplicate_candidate rows (zero fills) still counts as non-empty", () => {
  const row = auditRow({
    id: "audit-queue-only",
    fills: [],
    duplicateCandidatesQueued: [{ id: "dc1", personAId: "a", personBId: "b" }],
  });
  const selection = selectNameFromEmailBackfillAuditRow([row], null);
  assert.deepEqual(selection, { kind: "selected", row });
});

test("selectNameFromEmailBackfillAuditRow refuses when several non-empty rows exist and no --audit-id was given, listing every candidate", () => {
  const first = auditRow({ id: "audit-1", at: new Date("2026-09-29T00:00:00.000Z") });
  const second = auditRow({ id: "audit-2", at: new Date("2026-09-30T00:00:00.000Z") });
  const selection = selectNameFromEmailBackfillAuditRow([first, second], null);
  assert.equal(selection.kind, "ambiguous");
  if (selection.kind === "ambiguous") {
    assert.deepEqual(
      selection.candidates.map((c) => c.id).sort(),
      ["audit-1", "audit-2"],
    );
  }
});

test("selectNameFromEmailBackfillAuditRow selects the row matching an explicit --audit-id among several", () => {
  const first = auditRow({ id: "audit-1" });
  const second = auditRow({ id: "audit-2" });
  const selection = selectNameFromEmailBackfillAuditRow([first, second], "audit-2");
  assert.deepEqual(selection, { kind: "selected", row: second });
});

test("selectNameFromEmailBackfillAuditRow reports not_found for an --audit-id that doesn't match any non-empty row, listing the real candidates", () => {
  const first = auditRow({ id: "audit-1" });
  const empty = auditRow({ id: "audit-empty", fills: [], duplicateCandidatesQueued: [] });
  const selection = selectNameFromEmailBackfillAuditRow([first, empty], "nonexistent-id");
  assert.equal(selection.kind, "not_found");
  if (selection.kind === "not_found") {
    assert.equal(selection.requestedAuditId, "nonexistent-id");
    assert.deepEqual(selection.candidates.map((c) => c.id), ["audit-1"]);
  }
});

test("selectNameFromEmailBackfillAuditRow with an explicit --audit-id never matches an empty (legacy/defensive) row even if the id matches", () => {
  const empty = auditRow({ id: "audit-empty", fills: [], duplicateCandidatesQueued: [] });
  const selection = selectNameFromEmailBackfillAuditRow([empty], "audit-empty");
  assert.equal(selection.kind, "not_found");
});
