/**
 * Unit tests for src/lib/identity/nameFromEmailBackfillAudit.ts. Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNameFromEmailBackfillAuditMetadata,
  NAME_FROM_EMAIL_BACKFILL_AUDIT_ID_CAP,
} from "@/lib/identity/nameFromEmailBackfillAudit";

test("buildNameFromEmailBackfillAuditMetadata reports fillsApplied/fillsSkippedRace and the full id list when under the cap", () => {
  const metadata = buildNameFromEmailBackfillAuditMetadata({
    fillsPlanned: 3,
    appliedPersonIds: ["p1", "p2", "p3"],
    skippedRacePersonIds: [],
  });
  assert.equal(metadata.fillsPlanned, 3);
  assert.equal(metadata.fillsApplied, 3);
  assert.equal(metadata.fillsSkippedRace, 0);
  assert.deepEqual(metadata.personIds, ["p1", "p2", "p3"]);
  assert.equal(metadata.personIdsTruncated, false);
});

test("buildNameFromEmailBackfillAuditMetadata reports a race-skipped fill without dropping it (applied < planned)", () => {
  const metadata = buildNameFromEmailBackfillAuditMetadata({
    fillsPlanned: 3,
    appliedPersonIds: ["p1", "p2"],
    skippedRacePersonIds: ["p3"],
  });
  assert.equal(metadata.fillsPlanned, 3);
  assert.equal(metadata.fillsApplied, 2);
  assert.equal(metadata.fillsSkippedRace, 1);
  assert.notEqual(metadata.fillsApplied, metadata.fillsPlanned);
});

test("buildNameFromEmailBackfillAuditMetadata truncates the person id list past the cap, but keeps the true applied count", () => {
  const many = Array.from({ length: NAME_FROM_EMAIL_BACKFILL_AUDIT_ID_CAP + 50 }, (_, i) => `person-${i}`);
  const metadata = buildNameFromEmailBackfillAuditMetadata({
    fillsPlanned: many.length,
    appliedPersonIds: many,
    skippedRacePersonIds: [],
  });
  assert.equal(metadata.fillsApplied, many.length);
  assert.equal(metadata.personIds.length, NAME_FROM_EMAIL_BACKFILL_AUDIT_ID_CAP);
  assert.equal(metadata.personIdsTruncated, true);
});
