import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEmailPatternInferenceBackfillAuditMetadata,
  isEmailPatternInferenceBackfillAuditWorthRecording,
} from "@/lib/identity/emailPatternInferenceBackfillAudit";

test("a no-op run (zero applied) is never worth recording", () => {
  assert.equal(isEmailPatternInferenceBackfillAuditWorthRecording({ appliedPersonIds: [] }), false);
});

test("at least one applied fill is worth recording", () => {
  assert.equal(isEmailPatternInferenceBackfillAuditWorthRecording({ appliedPersonIds: ["p1"] }), true);
});

test("metadata carries a revert-ready SQL note when the id list isn't truncated", () => {
  const metadata = buildEmailPatternInferenceBackfillAuditMetadata({
    fillsPlanned: 2,
    appliedPersonIds: ["p1", "p2"],
    skippedRacePersonIds: [],
  });
  assert.equal(metadata.appliedCount, 2);
  assert.equal(metadata.appliedPersonIdsTruncated, false);
  assert.match(metadata.revertNote, /email_source = 'pattern_inferred'/);
});
