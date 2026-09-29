/**
 * Unit tests for src/lib/identity/stuffedNameSplitBackfillAudit.ts. Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStuffedNameSplitAuditMetadata,
  isStuffedNameSplitAuditWorthRecording,
  STUFFED_NAME_SPLIT_AUDIT_CAP,
} from "@/lib/identity/stuffedNameSplitBackfillAudit";

function fill(personId: string, firstName = "Leon", lastName = "Sacks") {
  return {
    personId,
    firstName,
    lastName,
    originalFirstName: `${firstName} ${lastName}`,
    originalLastName: null,
    rule: "two_tokens" as const,
  };
}

test("buildStuffedNameSplitAuditMetadata reports fillsApplied/fillsSkippedRace and the full fill list under the cap", () => {
  const metadata = buildStuffedNameSplitAuditMetadata({
    fillsPlanned: 2,
    appliedFills: [fill("p1"), fill("p2", "Angela", "Leon")],
    skippedRacePersonIds: [],
  });
  assert.equal(metadata.fillsPlanned, 2);
  assert.equal(metadata.fillsApplied, 2);
  assert.equal(metadata.fillsSkippedRace, 0);
  assert.deepEqual(metadata.fills, [fill("p1"), fill("p2", "Angela", "Leon")]);
  assert.equal(metadata.fillsTruncated, false);
});

test("buildStuffedNameSplitAuditMetadata reports a race-skipped fill without dropping it (applied < planned)", () => {
  const metadata = buildStuffedNameSplitAuditMetadata({
    fillsPlanned: 2,
    appliedFills: [fill("p1")],
    skippedRacePersonIds: ["p2"],
  });
  assert.equal(metadata.fillsPlanned, 2);
  assert.equal(metadata.fillsApplied, 1);
  assert.equal(metadata.fillsSkippedRace, 1);
  assert.notEqual(metadata.fillsApplied, metadata.fillsPlanned);
});

test("buildStuffedNameSplitAuditMetadata truncates the fill list past the cap, but keeps the true applied count", () => {
  const many = Array.from({ length: STUFFED_NAME_SPLIT_AUDIT_CAP + 50 }, (_, i) => fill(`person-${i}`));
  const metadata = buildStuffedNameSplitAuditMetadata({
    fillsPlanned: many.length,
    appliedFills: many,
    skippedRacePersonIds: [],
  });
  assert.equal(metadata.fillsApplied, many.length);
  assert.equal(metadata.fills.length, STUFFED_NAME_SPLIT_AUDIT_CAP);
  assert.equal(metadata.fillsTruncated, true);
});

// --- isStuffedNameSplitAuditWorthRecording -----------------------------------
// CRITICAL fix (same as nameFromEmailBackfill): an empty --execute re-run
// must never write an audit_log row — it would become the newest row and
// hide the real backfill from --revert.

test("isStuffedNameSplitAuditWorthRecording is false when nothing was applied", () => {
  assert.equal(isStuffedNameSplitAuditWorthRecording({ appliedFills: [] }), false);
});

test("isStuffedNameSplitAuditWorthRecording is true when at least one fill was applied", () => {
  assert.equal(isStuffedNameSplitAuditWorthRecording({ appliedFills: [fill("p1")] }), true);
});
