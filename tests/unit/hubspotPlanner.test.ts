/**
 * Unit tests for src/lib/hubspot/planner.ts — the pure single entry point
 * orchestrating companies -> contacts -> identity -> refill -> activities
 * (task 3.9), and the row outcome classification it produces (task 3.10:
 * every row lands in exactly one of new/review/profile_key/
 * skipped_own_company/already_imported/invalid).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HubSpotContactRow } from "@/lib/hubspot/contacts";
import type { HubSpotCompanyRow, ExistingCompanyRef } from "@/lib/hubspot/companies";
import { planHubSpotImport, type PlanHubSpotImportInput } from "@/lib/hubspot/planner";

const RUN_AT = new Date("2026-09-26T12:00:00Z");

function contact(overrides: Partial<HubSpotContactRow> = {}): HubSpotContactRow {
  return {
    hubspotContactId: "1",
    firstName: "Jane",
    lastName: "Doe",
    email: null,
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
    leadStatus: "Nuevo",
    associatedCompanyIdPrimary: null,
    associatedCompanyIdPrimaryMultiple: false,
    ...overrides,
  };
}

function baseInput(overrides: Partial<PlanHubSpotImportInput> = {}): PlanHubSpotImportInput {
  return {
    contacts: [],
    companies: [],
    existingCompanies: [],
    existingNoteHubspotCompanyIds: new Set(),
    bds: [],
    existingHubspotPersonIds: new Map(),
    existingPersonsForRefill: new Map(),
    identityIndex: [],
    migrationRunId: null,
    runAt: RUN_AT,
    ...overrides,
  };
}

test("every row lands in exactly one outcome and the report accounts for all N rows", () => {
  const result = planHubSpotImport(
    baseInput({
      contacts: [
        contact({ hubspotContactId: "1", firstName: "Jane" }),
        contact({ hubspotContactId: "2", firstName: "John" }),
        contact({ hubspotContactId: "3", firstName: "Alice" }),
      ],
    }),
  );
  assert.equal(result.outcomes.length, 3);
  const total = Object.values(result.report.outcomes).reduce((a, b) => a + b, 0);
  assert.equal(total, 3);
});

test("a row whose hubspotContactId is already mapped is classified 'already_imported', not 'new'", () => {
  const result = planHubSpotImport(
    baseInput({
      contacts: [contact({ hubspotContactId: "1" })],
      existingHubspotPersonIds: new Map([["1", "person-existing"]]),
      existingPersonsForRefill: new Map([
        [
          "person-existing",
          {
            id: "person-existing",
            firstName: "Jane",
            lastName: "Doe",
            company: null,
            companyKey: null,
            jobTitle: null,
            industry: null,
            city: null,
            country: null,
            ownerBdId: null,
            email: null,
            emailNormalized: null,
            emailStatus: "none",
            emailConfidence: null,
            emailSource: null,
          },
        ],
      ]),
    }),
  );
  assert.equal(result.outcomes[0].outcome, "already_imported");
  assert.equal(result.outcomes[0].personId, "person-existing");
  assert.equal(result.report.outcomes.already_imported, 1);
  assert.equal(result.report.outcomes.new, 0);
});

test("an already_imported row is planned through refill (fills only empty fields), not through the matcher", () => {
  const result = planHubSpotImport(
    baseInput({
      contacts: [contact({ hubspotContactId: "1", jobTitle: "VP of Engineering" })],
      existingHubspotPersonIds: new Map([["1", "person-existing"]]),
      existingPersonsForRefill: new Map([
        [
          "person-existing",
          {
            id: "person-existing",
            firstName: "Jane",
            lastName: "Doe",
            company: null,
            companyKey: null,
            jobTitle: null,
            industry: null,
            city: null,
            country: null,
            ownerBdId: null,
            email: null,
            emailNormalized: null,
            emailStatus: "none",
            emailConfidence: null,
            emailSource: null,
          },
        ],
      ]),
    }),
  );
  assert.equal(result.refillPlans.length, 1);
  assert.equal(result.refillPlans[0].plan.personUpdate!.jobTitle, "VP of Engineering");
  assert.equal(result.identityPlan?.newPersons.length ?? 0, 0);
});

test("a duplicate hubspotContactId within the same file is classified 'invalid' on its second occurrence", () => {
  const result = planHubSpotImport(
    baseInput({
      contacts: [
        contact({ hubspotContactId: "1", firstName: "Jane" }),
        contact({ hubspotContactId: "1", firstName: "Jane-Duplicate" }),
      ],
    }),
  );
  assert.equal(result.outcomes[0].outcome, "new");
  assert.equal(result.outcomes[1].outcome, "invalid");
  assert.equal(result.report.outcomes.invalid, 1);
  assert.equal(result.report.warnings.duplicateHubspotContactIds.includes("1"), true);
});

test("an own-company row is classified 'skipped_own_company' and never reaches the matcher", () => {
  const companies: HubSpotCompanyRow[] = [
    { hubspotCompanyId: "co-1", name: "Avalith", domain: null, additionalDomains: [], note: null, city: null, country: null, sector: null },
  ];
  const result = planHubSpotImport(
    baseInput({
      contacts: [contact({ hubspotContactId: "1", associatedCompanyIdPrimary: "co-1" })],
      companies,
    }),
  );
  assert.equal(result.outcomes[0].outcome, "skipped_own_company");
  assert.equal(result.report.outcomes.skipped_own_company, 1);
  assert.equal(result.identityPlan?.newPersons.length ?? 0, 0);
});

test("an unmatched row with a resolved company creates a new person with that companyKey", () => {
  const companies: HubSpotCompanyRow[] = [
    { hubspotCompanyId: "co-1", name: "Acme Corp", domain: "acme.com", additionalDomains: [], note: null, city: null, country: null, sector: null },
  ];
  const result = planHubSpotImport(
    baseInput({
      contacts: [contact({ hubspotContactId: "1", associatedCompanyIdPrimary: "co-1" })],
      companies,
    }),
  );
  assert.equal(result.outcomes[0].outcome, "new");
  const newPerson = result.identityPlan!.newPersons[0]!;
  assert.equal(newPerson.merged.companyKey, "acme");
});

test("owner mapping: an accent-insensitive match is counted, an unknown name is counted distinctly", () => {
  const result = planHubSpotImport(
    baseInput({
      contacts: [
        contact({ hubspotContactId: "1", ownerRaw: "Macarena Davila" }),
        contact({ hubspotContactId: "2", ownerRaw: "Someone Unknown" }),
      ],
      bds: [{ id: "bd-1", name: "Macarena Dávila" }],
    }),
  );
  assert.equal(result.report.owners.mapped["Macarena Dávila"], 1);
  assert.equal(result.report.owners.unknown["Someone Unknown"], 1);
  const assignedOutcome = result.identityPlan!.newPersons.find((np) => np.merged.ownerBdId === "bd-1");
  assert.ok(assignedOutcome);
});

test("status evidence: a row with contacted evidence gets a planned status_backfill activity keyed to its person ref", () => {
  const result = planHubSpotImport(
    baseInput({
      contacts: [contact({ hubspotContactId: "1", timesContacted: 3 })],
    }),
  );
  assert.equal(result.statusEvidence.length, 1);
  assert.equal(result.statusEvidence[0].plan.activities[0].status, "contacted");
  assert.equal(result.statusEvidence[0].hubspotContactId, "1");
  assert.equal(result.report.backfills.contacted, 1);
});

test("status evidence is not planned for a skipped own-company row", () => {
  const companies: HubSpotCompanyRow[] = [
    { hubspotCompanyId: "co-1", name: "Avalith", domain: null, additionalDomains: [], note: null, city: null, country: null, sector: null },
  ];
  const result = planHubSpotImport(
    baseInput({
      contacts: [contact({ hubspotContactId: "1", associatedCompanyIdPrimary: "co-1", timesContacted: 3 })],
      companies,
    }),
  );
  assert.equal(result.statusEvidence.length, 0);
});

test("companyResolution passthrough exposes company-side counts (domain match, created, notes)", () => {
  const existingCompanies: ExistingCompanyRef[] = [{ companyKey: "acme corp", domain: "acme.com" }];
  const companies: HubSpotCompanyRow[] = [
    { hubspotCompanyId: "co-1", name: "Acme Corp", domain: "acme.com", additionalDomains: [], note: null, city: null, country: null, sector: null },
  ];
  const result = planHubSpotImport(
    baseInput({
      contacts: [contact({ hubspotContactId: "1", associatedCompanyIdPrimary: "co-1" })],
      companies,
      existingCompanies,
    }),
  );
  assert.equal(result.companyResolution.byHubspotCompanyId.get("co-1")?.matchReason, "domain");
});
