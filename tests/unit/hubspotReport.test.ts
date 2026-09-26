/**
 * Unit tests for src/lib/hubspot/report.ts (design D7/D8; hubspot-import
 * spec "PII-safe dry-run report" / "Review-count threshold gate"). Pure,
 * no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHubSpotRunReport,
  HUBSPOT_REVIEW_THRESHOLD,
  redactReportForLog,
  type HubSpotRunReport,
} from "@/lib/hubspot/report";
import type { HubSpotContactRow } from "@/lib/hubspot/contacts";
import type {
  HubSpotContactPlanOutcome,
  HubSpotImportReport,
  PlanHubSpotImportResult,
} from "@/lib/hubspot/planner";

function emptyReport(overrides: Partial<HubSpotImportReport["outcomes"]> = {}): HubSpotImportReport {
  return {
    rowsRead: 1,
    outcomes: { new: 0, review: 0, profile_key: 0, skipped_own_company: 0, already_imported: 0, invalid: 0, ...overrides },
    owners: { mapped: { Ana: 3 }, unassigned: 1, unknown: { "John Doe": 2 } },
    companies: { matchedByDomain: 1, matchedByName: 0, matchedByCompact: 0, created: 1, ownCompany: 0, noCompanyResolved: 0, notes: 0 },
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
}

function contact(id: string, overrides: Partial<HubSpotContactRow> = {}): HubSpotContactRow {
  return {
    hubspotContactId: id,
    firstName: "Jane",
    lastName: "Doe",
    email: `jane${id}@acme.com`,
    jobTitle: null,
    city: null,
    country: null,
    phone: null,
    linkedinUrl: null,
    ownerRaw: null,
    timesContacted: 0,
    lastContactAt: null,
    lastActivityAt: null,
    createdAt: null,
    leadStatus: null,
    associatedCompanyIdPrimary: null,
    associatedCompanyIdPrimaryMultiple: false,
    ...overrides,
  };
}

function planResult(outcomes: HubSpotContactPlanOutcome[], reviewCount = 0): PlanHubSpotImportResult {
  return {
    companyResolution: {
      byHubspotCompanyId: new Map(),
      companiesToCreate: [{ companyKey: "acme", displayName: "Acme", domain: "acme.com", hubspotCompanyId: "1" }],
      domainFills: [{ companyKey: "beta", domain: "beta.com" }],
      domainConflicts: [],
      notesToCreate: [],
      ambiguousCompactMatches: 0,
    },
    identityPlan: null,
    refillPlans: [],
    statusEvidence: [],
    outcomes,
    report: emptyReport({ review: reviewCount }),
  };
}

test("HUBSPOT_REVIEW_THRESHOLD is 300 (hubspot-import spec)", () => {
  assert.equal(HUBSPOT_REVIEW_THRESHOLD, 300);
});

test("buildHubSpotRunReport surfaces createdCompanyKeys and domainFilledCompanyKeys from the company resolution", () => {
  const plan = planResult([]);
  const report = buildHubSpotRunReport(plan, new Map(), new Map());
  assert.deepEqual(report.createdCompanyKeys, ["acme"]);
  assert.deepEqual(report.domainFilledCompanyKeys, ["beta"]);
});

test("buildHubSpotRunReport sets overThreshold when review count exceeds HUBSPOT_REVIEW_THRESHOLD", () => {
  const below = buildHubSpotRunReport(planResult([], 300), new Map(), new Map());
  const above = buildHubSpotRunReport(planResult([], 301), new Map(), new Map());
  assert.equal(below.overThreshold, false);
  assert.equal(above.overThreshold, true);
  assert.equal(below.reviewThreshold, 300);
});

test("buildHubSpotRunReport's reviewSample never exceeds 20 entries and is deterministic across calls", () => {
  const outcomes: HubSpotContactPlanOutcome[] = [];
  const contacts = new Map<string, HubSpotContactRow>();
  for (let i = 0; i < 30; i++) {
    const id = `c${i}`;
    outcomes.push({ hubspotContactId: id, outcome: "review", personId: `np${i}`, companyKey: "acme" });
    contacts.set(id, contact(id));
  }
  const plan: PlanHubSpotImportResult = {
    ...planResult(outcomes, 30),
    identityPlan: {
      rowOutcomes: [],
      newPersons: [],
      existingUpdates: [],
      reviewPairs: outcomes.map((o, i) => ({
        refA: o.personId!,
        refB: `existing-${i}`,
        reason: "name_company",
        matchKey: "jane doe::acme",
      })),
      report: { rowsRead: 30, ownCompanySkipped: 0, autoMerged: 0, flaggedForReview: 30, new: 0 },
    },
  };
  const existingById = new Map(
    outcomes.map((o, i) => [`existing-${i}`, { firstName: "Existing", lastName: `${i}`, companyKey: "acme" }]),
  );

  const first = buildHubSpotRunReport(plan, contacts, existingById);
  const second = buildHubSpotRunReport(plan, contacts, existingById);
  assert.ok(first.reviewSample.length <= 20);
  assert.deepEqual(
    first.reviewSample.map((e) => e.existing.personId),
    second.reviewSample.map((e) => e.existing.personId),
  );
  for (const entry of first.reviewSample) {
    assert.equal(entry.reason, "name_company");
    assert.ok(!("email" in entry.incoming));
  }
});

test("redactReportForLog removes reviewSample and collapses owner maps to counts", () => {
  const plan = planResult([]);
  const report = buildHubSpotRunReport(plan, new Map(), new Map());
  const redacted = redactReportForLog(report as HubSpotRunReport);
  assert.equal((redacted as unknown as { reviewSample?: unknown }).reviewSample, undefined);
  assert.equal(redacted.owners.mapped, 3);
  assert.equal(redacted.owners.unknown, 2);
  assert.equal(redacted.owners.unassigned, 1);
});

test("redactReportForLog never leaks a name or email — only counts and company keys survive", () => {
  const outcomes: HubSpotContactPlanOutcome[] = [
    { hubspotContactId: "c1", outcome: "review", personId: "np1", companyKey: "acme" },
  ];
  const contacts = new Map([["c1", contact("c1")]]);
  const plan: PlanHubSpotImportResult = {
    ...planResult(outcomes, 1),
    identityPlan: {
      rowOutcomes: [],
      newPersons: [],
      existingUpdates: [],
      reviewPairs: [{ refA: "np1", refB: "existing-0", reason: "name_company", matchKey: "jane doe::acme" }],
      report: { rowsRead: 1, ownCompanySkipped: 0, autoMerged: 0, flaggedForReview: 1, new: 0 },
    },
  };
  const existingById = new Map([["existing-0", { firstName: "Existing", lastName: "Person", companyKey: "acme" }]]);
  const report = buildHubSpotRunReport(plan, contacts, existingById);
  const redacted = redactReportForLog(report);
  const serialized = JSON.stringify(redacted);
  assert.ok(!serialized.includes("Jane"));
  assert.ok(!serialized.includes("acme.com"));
});
