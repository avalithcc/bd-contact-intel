/**
 * Unit tests for src/lib/companies/defaultPipelineStageAudit.ts. Pure
 * metadata builder — no DB. Mirrors
 * src/lib/accounts/accountTypeBackfillAudit.ts's shape (one `audit_log`
 * row per run, counts + capped company-key lists per bucket).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDefaultPipelineStageAuditMetadata,
  DEFAULT_PIPELINE_STAGE_AUDIT_KEY_CAP,
  isDefaultPipelineStageAuditWorthRecording,
} from "@/lib/companies/defaultPipelineStageAudit";

test("buildDefaultPipelineStageAuditMetadata reports exact counts and the company keys per stage", () => {
  const metadata = buildDefaultPipelineStageAuditMetadata({
    appliedByStage: { won: ["c1"], qualified: ["c2", "c3"], prospect: ["c4"] },
  });
  assert.equal(metadata.wonCount, 1);
  assert.deepEqual(metadata.wonCompanyKeys, ["c1"]);
  assert.equal(metadata.wonCompanyKeysTruncated, false);
  assert.equal(metadata.qualifiedCount, 2);
  assert.deepEqual(metadata.qualifiedCompanyKeys, ["c2", "c3"]);
  assert.equal(metadata.prospectCount, 1);
  assert.deepEqual(metadata.prospectCompanyKeys, ["c4"]);
});

test("buildDefaultPipelineStageAuditMetadata caps each stage's key list but keeps the exact count", () => {
  const many = Array.from({ length: DEFAULT_PIPELINE_STAGE_AUDIT_KEY_CAP + 5 }, (_, i) => `c${i}`);
  const metadata = buildDefaultPipelineStageAuditMetadata({
    appliedByStage: { won: [], qualified: [], prospect: many },
  });
  assert.equal(metadata.prospectCount, many.length);
  assert.equal(metadata.prospectCompanyKeys.length, DEFAULT_PIPELINE_STAGE_AUDIT_KEY_CAP);
  assert.equal(metadata.prospectCompanyKeysTruncated, true);
});

test("isDefaultPipelineStageAuditWorthRecording is false when nothing was applied to any stage", () => {
  assert.equal(
    isDefaultPipelineStageAuditWorthRecording({ appliedByStage: { won: [], qualified: [], prospect: [] } }),
    false,
  );
});

test("isDefaultPipelineStageAuditWorthRecording is true when at least one stage got a row", () => {
  assert.equal(
    isDefaultPipelineStageAuditWorthRecording({ appliedByStage: { won: ["c1"], qualified: [], prospect: [] } }),
    true,
  );
});
