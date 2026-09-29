/**
 * Unit tests for src/lib/identity/nameFromEmailBackfillAudit.ts. Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNameFromEmailBackfillAuditMetadata,
  isNameFromEmailBackfillAuditWorthRecording,
  NAME_FROM_EMAIL_BACKFILL_AUDIT_CAP,
} from "@/lib/identity/nameFromEmailBackfillAudit";

function fill(personId: string, firstName = "Efrain", lastName = "Romero") {
  return { personId, firstName, lastName };
}

test("buildNameFromEmailBackfillAuditMetadata reports fillsApplied/fillsSkippedRace and the full fill list (with written names) when under the cap", () => {
  const metadata = buildNameFromEmailBackfillAuditMetadata({
    fillsPlanned: 3,
    appliedFills: [fill("p1"), fill("p2", "Javier", "Astort"), fill("p3")],
    skippedRacePersonIds: [],
    queuedDuplicateCandidates: [],
    alreadyQueuedDuplicateCandidatesCount: 0,
  });
  assert.equal(metadata.fillsPlanned, 3);
  assert.equal(metadata.fillsApplied, 3);
  assert.equal(metadata.fillsSkippedRace, 0);
  assert.deepEqual(metadata.fills, [fill("p1"), fill("p2", "Javier", "Astort"), fill("p3")]);
  assert.equal(metadata.fillsTruncated, false);
});

test("buildNameFromEmailBackfillAuditMetadata reports a race-skipped fill without dropping it (applied < planned)", () => {
  const metadata = buildNameFromEmailBackfillAuditMetadata({
    fillsPlanned: 3,
    appliedFills: [fill("p1"), fill("p2")],
    skippedRacePersonIds: ["p3"],
    queuedDuplicateCandidates: [],
    alreadyQueuedDuplicateCandidatesCount: 0,
  });
  assert.equal(metadata.fillsPlanned, 3);
  assert.equal(metadata.fillsApplied, 2);
  assert.equal(metadata.fillsSkippedRace, 1);
  assert.notEqual(metadata.fillsApplied, metadata.fillsPlanned);
});

test("buildNameFromEmailBackfillAuditMetadata truncates the fill list past the cap, but keeps the true applied count", () => {
  const many = Array.from({ length: NAME_FROM_EMAIL_BACKFILL_AUDIT_CAP + 50 }, (_, i) => fill(`person-${i}`));
  const metadata = buildNameFromEmailBackfillAuditMetadata({
    fillsPlanned: many.length,
    appliedFills: many,
    skippedRacePersonIds: [],
    queuedDuplicateCandidates: [],
    alreadyQueuedDuplicateCandidatesCount: 0,
  });
  assert.equal(metadata.fillsApplied, many.length);
  assert.equal(metadata.fills.length, NAME_FROM_EMAIL_BACKFILL_AUDIT_CAP);
  assert.equal(metadata.fillsTruncated, true);
});

test("buildNameFromEmailBackfillAuditMetadata records queued duplicate_candidate ids for the revert path", () => {
  const metadata = buildNameFromEmailBackfillAuditMetadata({
    fillsPlanned: 1,
    appliedFills: [fill("p1")],
    skippedRacePersonIds: [],
    queuedDuplicateCandidates: [{ id: "dc1", personAId: "p1", personBId: "existing-1" }],
    alreadyQueuedDuplicateCandidatesCount: 2,
  });
  assert.deepEqual(metadata.duplicateCandidatesQueued, [{ id: "dc1", personAId: "p1", personBId: "existing-1" }]);
  assert.equal(metadata.duplicateCandidatesQueuedTruncated, false);
  assert.equal(metadata.duplicateCandidatesAlreadyQueued, 2);
});

test("buildNameFromEmailBackfillAuditMetadata truncates the duplicate_candidate id list past the cap", () => {
  const many = Array.from({ length: NAME_FROM_EMAIL_BACKFILL_AUDIT_CAP + 10 }, (_, i) => ({
    id: `dc-${i}`,
    personAId: `a-${i}`,
    personBId: `b-${i}`,
  }));
  const metadata = buildNameFromEmailBackfillAuditMetadata({
    fillsPlanned: 0,
    appliedFills: [],
    skippedRacePersonIds: [],
    queuedDuplicateCandidates: many,
    alreadyQueuedDuplicateCandidatesCount: 0,
  });
  assert.equal(metadata.duplicateCandidatesQueued.length, NAME_FROM_EMAIL_BACKFILL_AUDIT_CAP);
  assert.equal(metadata.duplicateCandidatesQueuedTruncated, true);
});

// --- isNameFromEmailBackfillAuditWorthRecording ------------------------------
// CRITICAL fix: an empty --execute re-run must never write an audit_log row
// (it would become the "latest" and hide the real backfill from --revert).

test("isNameFromEmailBackfillAuditWorthRecording is false when nothing was applied and nothing was queued", () => {
  assert.equal(
    isNameFromEmailBackfillAuditWorthRecording({ appliedFills: [], queuedDuplicateCandidates: [] }),
    false,
  );
});

test("isNameFromEmailBackfillAuditWorthRecording is true when at least one fill was applied", () => {
  assert.equal(
    isNameFromEmailBackfillAuditWorthRecording({ appliedFills: [fill("p1")], queuedDuplicateCandidates: [] }),
    true,
  );
});

test("isNameFromEmailBackfillAuditWorthRecording is true when at least one duplicate_candidate was queued, even with zero fills", () => {
  assert.equal(
    isNameFromEmailBackfillAuditWorthRecording({
      appliedFills: [],
      queuedDuplicateCandidates: [{ id: "dc1", personAId: "a", personBId: "b" }],
    }),
    true,
  );
});
