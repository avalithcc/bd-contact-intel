/**
 * Unit tests for src/lib/emailVerification/hubspotImportVerifiedBackfill.ts.
 * Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHubspotEmailVerifiedBackfillAuditMetadata,
  HUBSPOT_EMAIL_VERIFIED_BACKFILL_AUDIT_ID_CAP,
  isHubspotImportProbableEmail,
} from "@/lib/emailVerification/hubspotImportVerifiedBackfill";

test("isHubspotImportProbableEmail matches a probable row sourced from hubspot_import", () => {
  assert.equal(isHubspotImportProbableEmail({ emailStatus: "probable", emailSource: "hubspot_import" }), true);
});

test("isHubspotImportProbableEmail rejects a probable row from any other source, including null", () => {
  assert.equal(
    isHubspotImportProbableEmail({ emailStatus: "probable", emailSource: "fi-arg-2026-mails-hunter" }),
    false,
  );
  assert.equal(isHubspotImportProbableEmail({ emailStatus: "probable", emailSource: null }), false);
});

test("isHubspotImportProbableEmail rejects a hubspot_import row that is not probable", () => {
  assert.equal(isHubspotImportProbableEmail({ emailStatus: "verified", emailSource: "hubspot_import" }), false);
  assert.equal(isHubspotImportProbableEmail({ emailStatus: "none", emailSource: "hubspot_import" }), false);
});

test("buildHubspotEmailVerifiedBackfillAuditMetadata reports the full id list and count when under the cap", () => {
  const metadata = buildHubspotEmailVerifiedBackfillAuditMetadata({ updatedPersonIds: ["a", "b", "c"] });
  assert.equal(metadata.updatedCount, 3);
  assert.deepEqual(metadata.updatedPersonIds, ["a", "b", "c"]);
  assert.equal(metadata.updatedPersonIdsTruncated, false);
  assert.match(metadata.revertNote, /update person set email_status = 'probable'/);
});

test("buildHubspotEmailVerifiedBackfillAuditMetadata truncates past the cap but keeps the true count", () => {
  const many = Array.from({ length: HUBSPOT_EMAIL_VERIFIED_BACKFILL_AUDIT_ID_CAP + 76 }, (_, i) => `id-${i}`);
  const metadata = buildHubspotEmailVerifiedBackfillAuditMetadata({ updatedPersonIds: many });
  assert.equal(metadata.updatedCount, many.length);
  assert.equal(metadata.updatedPersonIds.length, HUBSPOT_EMAIL_VERIFIED_BACKFILL_AUDIT_ID_CAP);
  assert.equal(metadata.updatedPersonIdsTruncated, true);
  assert.match(metadata.revertNote, /re-run this script's dry run/);
});
