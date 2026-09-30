/**
 * Unit tests for src/lib/identity/stuffedNameFirstTokenSplitAudit.ts. Pure,
 * no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFirstTokenSplitAuditMetadata,
  FIRST_TOKEN_SPLIT_AUDIT_CAP,
  isFirstTokenSplitAuditWorthRecording,
} from "@/lib/identity/stuffedNameFirstTokenSplitAudit";

function fill(personId: string, firstName = "Julián", lastName = "Zamudio Lemos") {
  return {
    personId,
    firstName,
    lastName,
    originalFirstName: `${firstName} ${lastName}`,
    originalLastName: null,
    rule: "plain" as const,
  };
}

test("buildFirstTokenSplitAuditMetadata reports fillsApplied/fillsSkippedRace and the full fill list under the cap", () => {
  const metadata = buildFirstTokenSplitAuditMetadata({
    fillsPlanned: 2,
    appliedFills: [fill("p1"), fill("p2", "Augusto D.", "Schultheis")],
    skippedRacePersonIds: [],
  });
  assert.equal(metadata.fillsPlanned, 2);
  assert.equal(metadata.fillsApplied, 2);
  assert.equal(metadata.fillsSkippedRace, 0);
  assert.deepEqual(metadata.fills, [fill("p1"), fill("p2", "Augusto D.", "Schultheis")]);
  assert.equal(metadata.fillsTruncated, false);
});

test("buildFirstTokenSplitAuditMetadata reports a race-skipped fill without dropping it (applied < planned)", () => {
  const metadata = buildFirstTokenSplitAuditMetadata({
    fillsPlanned: 2,
    appliedFills: [fill("p1")],
    skippedRacePersonIds: ["p2"],
  });
  assert.equal(metadata.fillsPlanned, 2);
  assert.equal(metadata.fillsApplied, 1);
  assert.equal(metadata.fillsSkippedRace, 1);
  assert.notEqual(metadata.fillsApplied, metadata.fillsPlanned);
});

test("buildFirstTokenSplitAuditMetadata truncates the fill list past the cap, but keeps the true applied count", () => {
  const many = Array.from({ length: FIRST_TOKEN_SPLIT_AUDIT_CAP + 50 }, (_, i) => fill(`person-${i}`));
  const metadata = buildFirstTokenSplitAuditMetadata({
    fillsPlanned: many.length,
    appliedFills: many,
    skippedRacePersonIds: [],
  });
  assert.equal(metadata.fillsApplied, many.length);
  assert.equal(metadata.fills.length, FIRST_TOKEN_SPLIT_AUDIT_CAP);
  assert.equal(metadata.fillsTruncated, true);
});

// --- isFirstTokenSplitAuditWorthRecording -------------------------------------
// CRITICAL fix (same as stuffedNameSplitBackfillAudit): an empty --execute
// re-run must never write an audit_log row — it would become the newest row
// and hide the real backfill from --revert.

test("isFirstTokenSplitAuditWorthRecording is false when nothing was applied", () => {
  assert.equal(isFirstTokenSplitAuditWorthRecording({ appliedFills: [] }), false);
});

test("isFirstTokenSplitAuditWorthRecording is true when at least one fill was applied", () => {
  assert.equal(isFirstTokenSplitAuditWorthRecording({ appliedFills: [fill("p1")] }), true);
});
