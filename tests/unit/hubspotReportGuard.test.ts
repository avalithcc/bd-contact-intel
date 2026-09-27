/**
 * Unit tests for src/lib/hubspot/reportGuard.ts. Pure, no DB.
 *
 * Follow-up fix (prod run c9de8587): `/admin/migration` showed nothing for
 * an executed run because the page's `isHubSpotReport` guard required
 * `reviewSample`/`reviewThreshold`, which an executed run's OLDER, partial
 * report shape doesn't have (see hubspotRun.test.ts / importQueries.ts for
 * the write-side fix). This guard must still recognize a hubspot_import
 * report even when those two fields are absent, and the accessor helpers
 * must fall back to safe defaults instead of throwing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hubspotOverThreshold, hubspotReviewSample, isHubSpotReport } from "@/lib/hubspot/reportGuard";
import type { HubSpotRunReport } from "@/lib/hubspot/report";

const baseFields = {
  rowsRead: 1,
  outcomes: { new: 0, review: 0, profile_key: 0, skipped_own_company: 0, already_imported: 0, invalid: 0 },
  owners: { mapped: {}, unassigned: 0, unknown: {} },
  companies: {
    matchedByDomain: 0,
    matchedByName: 0,
    matchedByCompact: 0,
    created: 0,
    ownCompany: 0,
    noCompanyResolved: 0,
    notes: 0,
    compactMatches: [],
  },
  backfills: { contacted: 0, replied: 0, discarded: 0 },
  dateFallback: 0,
  warnings: {
    duplicateHubspotContactIds: [],
    associatedCompanyIdPrimaryMultiple: 0,
    noCompanyResolved: 0,
    domainConflicts: 0,
    ambiguousCompactMatches: 0,
    unknownLeadStatuses: {},
  },
};

test("isHubSpotReport recognizes the full report shape (dry run / fixed execute)", () => {
  const report = {
    ...baseFields,
    reviewThreshold: 300,
    overThreshold: false,
    createdCompanyKeys: [],
    domainFilledCompanyKeys: [],
    reviewSample: [],
  };
  assert.equal(isHubSpotReport(report), true);
});

test("isHubSpotReport recognizes the OLDER, partial shape a prod-executed run persisted before the fix (no reviewSample/reviewThreshold)", () => {
  assert.equal(isHubSpotReport(baseFields), true);
});

test("isHubSpotReport rejects a report from a different migration kind", () => {
  assert.equal(isHubSpotReport({ contact: {}, persons: [] }), false);
  assert.equal(isHubSpotReport(null), false);
  assert.equal(isHubSpotReport(undefined), false);
  assert.equal(isHubSpotReport("not an object"), false);
});

test("hubspotReviewSample falls back to an empty array when reviewSample is missing", () => {
  assert.deepEqual(hubspotReviewSample(baseFields), []);
});

test("hubspotReviewSample returns the real sample when present", () => {
  const sample = [
    {
      reason: "same_email",
      incoming: { name: "Jane", companyKey: "acme", emailDomain: "acme.com" },
      existing: { personId: "p1", name: "Jane D", companyKey: "acme" },
    },
  ];
  assert.deepEqual(hubspotReviewSample({ ...baseFields, reviewSample: sample } as unknown as HubSpotRunReport), sample);
});

test("hubspotOverThreshold falls back to false when overThreshold is missing", () => {
  assert.equal(hubspotOverThreshold(baseFields), false);
});

test("hubspotOverThreshold returns the real value when present", () => {
  assert.equal(hubspotOverThreshold({ ...baseFields, overThreshold: true } as unknown as HubSpotRunReport), true);
});
