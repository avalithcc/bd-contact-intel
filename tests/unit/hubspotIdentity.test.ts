/**
 * Unit tests for src/lib/hubspot/identity.ts — the pure HubSpotContactRow ->
 * IdentityIngestRow mapper (design D4, task 3.4). No DB, no CSV parsing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HubSpotContactRow } from "@/lib/hubspot/contacts";
import { mapHubSpotContactToIdentityRow } from "@/lib/hubspot/identity";

function contact(overrides: Partial<HubSpotContactRow> = {}): HubSpotContactRow {
  return {
    hubspotContactId: "123",
    firstName: "Jane",
    lastName: "Doe",
    email: null,
    jobTitle: "Head of Sales",
    city: "Buenos Aires",
    country: "Argentina",
    phone: null,
    linkedinUrl: null,
    ownerRaw: "Macarena Dávila",
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

test("maps hubspotContactId to a stable legacyId and legacyTable 'hubspot_contact'", () => {
  const row = mapHubSpotContactToIdentityRow({
    contact: contact({ hubspotContactId: "123" }),
    companyKey: null,
    ownerBdId: null,
    migrationRunId: null,
  });
  assert.equal(row.legacyTable, "hubspot_contact");
  assert.equal(row.legacyId, mapHubSpotContactToIdentityRow({ contact: contact({ hubspotContactId: "123" }), companyKey: null, ownerBdId: null, migrationRunId: null }).legacyId);
  // Deterministic uuid, not the raw numeric string.
  assert.match(row.legacyId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("a row with no email is stored with emailStatus 'none' and no emailSource", () => {
  const row = mapHubSpotContactToIdentityRow({
    contact: contact({ email: null }),
    companyKey: null,
    ownerBdId: null,
    migrationRunId: null,
  });
  assert.equal(row.email, null);
  assert.equal(row.emailStatus, "none");
  assert.equal(row.emailSource, null);
});

test("a row with an email is stored as emailStatus 'probable', emailSource 'hubspot_import' (contact-identity spec)", () => {
  const row = mapHubSpotContactToIdentityRow({
    contact: contact({ email: "jane@acme.com" }),
    companyKey: null,
    ownerBdId: null,
    migrationRunId: null,
  });
  assert.equal(row.email, "jane@acme.com");
  assert.equal(row.emailStatus, "probable");
  assert.equal(row.emailSource, "hubspot_import");
});

test("profileKey is normalizeProfileKey(linkedinUrl), null when there's no LinkedIn URL", () => {
  const withLinkedin = mapHubSpotContactToIdentityRow({
    contact: contact({ linkedinUrl: "https://www.linkedin.com/in/janedoe/" }),
    companyKey: null,
    ownerBdId: null,
    migrationRunId: null,
  });
  assert.equal(withLinkedin.profileKey, "linkedin.com/in/janedoe");

  const without = mapHubSpotContactToIdentityRow({
    contact: contact({ linkedinUrl: null }),
    companyKey: null,
    ownerBdId: null,
    migrationRunId: null,
  });
  assert.equal(without.profileKey, null);
});

test("bdId is the resolved ownerBdId, nullable — no person_bd_connection for HubSpot rows", () => {
  const assigned = mapHubSpotContactToIdentityRow({
    contact: contact(),
    companyKey: null,
    ownerBdId: "bd-1",
    migrationRunId: null,
  });
  assert.equal(assigned.bdId, "bd-1");
  assert.equal(assigned.ownerBdId, "bd-1");

  const unassigned = mapHubSpotContactToIdentityRow({
    contact: contact(),
    companyKey: null,
    ownerBdId: null,
    migrationRunId: null,
  });
  assert.equal(unassigned.bdId, null);
  assert.equal(unassigned.ownerBdId, null);
});

test("city/country/jobTitle pass through from the contact row", () => {
  const row = mapHubSpotContactToIdentityRow({
    contact: contact({ city: "CABA", country: "Argentina", jobTitle: "VP of Engineering" }),
    companyKey: null,
    ownerBdId: null,
    migrationRunId: null,
  });
  assert.equal(row.city, "CABA");
  assert.equal(row.country, "Argentina");
  assert.equal(row.jobTitle, "VP of Engineering");
});

test("companyKey is the resolved key passed in, not re-derived from anything on the contact row", () => {
  const row = mapHubSpotContactToIdentityRow({
    contact: contact(),
    companyKey: "acme",
    ownerBdId: null,
    migrationRunId: null,
  });
  assert.equal(row.companyKey, "acme");
});

test("migrationRunId passes through for the write-once field on new persons", () => {
  const row = mapHubSpotContactToIdentityRow({
    contact: contact(),
    companyKey: null,
    ownerBdId: null,
    migrationRunId: "run-1",
  });
  assert.equal(row.migrationRunId, "run-1");
});
