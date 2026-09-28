/**
 * Unit tests for src/lib/accounts/accountTypeBackfillAudit.ts. Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCOUNT_TYPE_BACKFILL_AUDIT_KEY_CAP,
  buildAccountTypeBackfillAuditMetadata,
} from "@/lib/accounts/accountTypeBackfillAudit";

test("buildAccountTypeBackfillAuditMetadata reports counts and full key lists under the cap", () => {
  const metadata = buildAccountTypeBackfillAuditMetadata({
    createdCompanyKeys: ["a", "b"],
    accountTypeUpdatedCompanyKeys: ["c", "d", "e"],
    notesFilledCompanyKeys: ["c"],
    notesSkippedNonEmpty: 2,
  });
  assert.equal(metadata.companiesCreated, 2);
  assert.deepEqual(metadata.createdCompanyKeys, ["a", "b"]);
  assert.equal(metadata.createdCompanyKeysTruncated, false);
  assert.equal(metadata.accountTypeUpdated, 3);
  assert.equal(metadata.notesFilled, 1);
  assert.equal(metadata.notesSkippedNonEmpty, 2);
  assert.deepEqual(metadata.accountTypeOverridesApplied, []);
});

test("buildAccountTypeBackfillAuditMetadata records applied owner overrides so the audit says a human decided", () => {
  const metadata = buildAccountTypeBackfillAuditMetadata({
    createdCompanyKeys: [],
    accountTypeUpdatedCompanyKeys: ["dynamic-tours"],
    notesFilledCompanyKeys: [],
    notesSkippedNonEmpty: 0,
    overridesApplied: [
      {
        displayName: "Dynamic Tours",
        companyKey: "dynamic-tours",
        previousAccountType: "strategic_org",
        accountType: "partner",
        reason: "Owner adjudicated on 2026-09-28: both source exports disagreed and were wrong.",
      },
    ],
  });
  assert.equal(metadata.accountTypeOverridesApplied.length, 1);
  assert.equal(metadata.accountTypeOverridesApplied[0]!.displayName, "Dynamic Tours");
  assert.equal(metadata.accountTypeOverridesApplied[0]!.previousAccountType, "strategic_org");
  assert.equal(metadata.accountTypeOverridesApplied[0]!.accountType, "partner");
  assert.match(metadata.accountTypeOverridesApplied[0]!.reason, /owner adjudicated/i);
});

test("buildAccountTypeBackfillAuditMetadata truncates key lists past the cap but keeps true counts", () => {
  const many = Array.from({ length: ACCOUNT_TYPE_BACKFILL_AUDIT_KEY_CAP + 10 }, (_, i) => `company-${i}`);
  const metadata = buildAccountTypeBackfillAuditMetadata({
    createdCompanyKeys: many,
    accountTypeUpdatedCompanyKeys: [],
    notesFilledCompanyKeys: [],
    notesSkippedNonEmpty: 0,
  });
  assert.equal(metadata.companiesCreated, many.length);
  assert.equal(metadata.createdCompanyKeys.length, ACCOUNT_TYPE_BACKFILL_AUDIT_KEY_CAP);
  assert.equal(metadata.createdCompanyKeysTruncated, true);
});
