/**
 * Unit tests for src/lib/hubspot/companyDomainBackfillAudit.ts. Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCompanyDomainBackfillAuditMetadata,
  COMPANY_DOMAIN_BACKFILL_AUDIT_KEY_CAP,
} from "@/lib/hubspot/companyDomainBackfillAudit";

test("buildCompanyDomainBackfillAuditMetadata reports fillsApplied/fillsSkippedRace/conflictsSkipped and the full key list when under the cap", () => {
  const metadata = buildCompanyDomainBackfillAuditMetadata({
    fillsPlanned: 3,
    appliedCompanyKeys: ["acme", "beta", "gamma"],
    skippedRaceCompanyKeys: [],
    conflictsSkipped: 2,
  });
  assert.equal(metadata.fillsPlanned, 3);
  assert.equal(metadata.fillsApplied, 3);
  assert.equal(metadata.fillsSkippedRace, 0);
  assert.equal(metadata.conflictsSkipped, 2);
  assert.deepEqual(metadata.companyKeys, ["acme", "beta", "gamma"]);
  assert.equal(metadata.companyKeysTruncated, false);
});

test("buildCompanyDomainBackfillAuditMetadata reports a race-skipped fill without dropping it (applied < planned)", () => {
  const metadata = buildCompanyDomainBackfillAuditMetadata({
    fillsPlanned: 3,
    appliedCompanyKeys: ["acme", "beta"],
    skippedRaceCompanyKeys: ["gamma"],
    conflictsSkipped: 0,
  });
  assert.equal(metadata.fillsPlanned, 3);
  assert.equal(metadata.fillsApplied, 2);
  assert.equal(metadata.fillsSkippedRace, 1);
  assert.notEqual(metadata.fillsApplied, metadata.fillsPlanned);
});

test("buildCompanyDomainBackfillAuditMetadata truncates the company key list past the cap, but keeps the true applied count", () => {
  const many = Array.from({ length: COMPANY_DOMAIN_BACKFILL_AUDIT_KEY_CAP + 50 }, (_, i) => `company-${i}`);
  const metadata = buildCompanyDomainBackfillAuditMetadata({
    fillsPlanned: many.length,
    appliedCompanyKeys: many,
    skippedRaceCompanyKeys: [],
    conflictsSkipped: 0,
  });
  assert.equal(metadata.fillsApplied, many.length);
  assert.equal(metadata.companyKeys.length, COMPANY_DOMAIN_BACKFILL_AUDIT_KEY_CAP);
  assert.equal(metadata.companyKeysTruncated, true);
});
