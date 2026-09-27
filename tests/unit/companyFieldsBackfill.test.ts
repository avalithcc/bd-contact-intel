/**
 * Unit tests for src/lib/hubspot/companyFieldsBackfill.ts — pure row-mapping
 * and fill-empty planner behind
 * scripts/backfill-hubspot-company-fields.ts. Synthetic fixtures only, never
 * real hubspot/ exports (PII).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapCompanyFieldsBackfillRow,
  planCompanyFieldsBackfill,
  type CompanyFieldsBackfillRow,
  type ExistingCompanyFieldsRow,
} from "@/lib/hubspot/companyFieldsBackfill";

const BD_1 = "11111111-1111-1111-1111-111111111111";

test("mapCompanyFieldsBackfillRow trims the record id and blanks empty cells to null", () => {
  const row = mapCompanyFieldsBackfillRow({
    "ID de registro": " 987 ",
    Sector: " Fintech ",
    Ciudad: "  ",
    "País/región": "Argentina",
    "Propietario del registro de empresa": " Cristian Civita ",
  });
  assert.deepEqual(row, {
    hubspotCompanyId: "987",
    industry: "Fintech",
    city: null,
    country: "Argentina",
    ownerRaw: "Cristian Civita",
  });
});

function existing(overrides: Partial<ExistingCompanyFieldsRow> = {}): ExistingCompanyFieldsRow {
  return { industry: null, city: null, country: null, ownerBdId: null, ...overrides };
}

test("planCompanyFieldsBackfill fills every empty field for a matched company", () => {
  const rows: CompanyFieldsBackfillRow[] = [
    {
      hubspotCompanyId: "987",
      companyKey: "acme",
      industry: "Fintech",
      city: "Buenos Aires",
      country: "Argentina",
      ownerBdId: BD_1,
    },
  ];
  const existingByKey = new Map([["acme", existing()]]);

  const plan = planCompanyFieldsBackfill(rows, existingByKey);
  assert.deepEqual(plan.updates, [
    { companyKey: "acme", industry: "Fintech", city: "Buenos Aires", country: "Argentina", ownerBdId: BD_1 },
  ]);
  assert.equal(plan.matched, 1);
  assert.equal(plan.skippedNoNewData, 0);
  assert.deepEqual(plan.fieldCounts, { industry: 1, city: 1, country: 1, ownerBdId: 1 });
});

test("planCompanyFieldsBackfill is fill-empty only: never overwrites an already-set field", () => {
  const rows: CompanyFieldsBackfillRow[] = [
    {
      hubspotCompanyId: "987",
      companyKey: "acme",
      industry: "Fintech",
      city: "Buenos Aires",
      country: "Argentina",
      ownerBdId: BD_1,
    },
  ];
  const existingByKey = new Map([
    ["acme", existing({ industry: "Software", city: "Rosario", country: "Argentina", ownerBdId: "existing-owner" })],
  ]);

  const plan = planCompanyFieldsBackfill(rows, existingByKey);
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.matched, 1);
  assert.equal(plan.skippedNoNewData, 1);
  assert.deepEqual(plan.fieldCounts, { industry: 0, city: 0, country: 0, ownerBdId: 0 });
});

test("planCompanyFieldsBackfill skips rows whose companyKey has no existing company row", () => {
  const rows: CompanyFieldsBackfillRow[] = [
    { hubspotCompanyId: "1", companyKey: "ghost", industry: "Fintech", city: null, country: null, ownerBdId: null },
  ];
  const plan = planCompanyFieldsBackfill(rows, new Map());
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.matched, 0);
});

test("planCompanyFieldsBackfill merges two HubSpot rows resolving to the same company, first non-null value wins per field", () => {
  const rows: CompanyFieldsBackfillRow[] = [
    { hubspotCompanyId: "1", companyKey: "acme", industry: "Fintech", city: null, country: null, ownerBdId: null },
    { hubspotCompanyId: "2", companyKey: "acme", industry: "Software", city: "Cordoba", country: "Argentina", ownerBdId: BD_1 },
  ];
  const existingByKey = new Map([["acme", existing()]]);

  const plan = planCompanyFieldsBackfill(rows, existingByKey);
  assert.deepEqual(plan.updates, [
    { companyKey: "acme", industry: "Fintech", city: "Cordoba", country: "Argentina", ownerBdId: BD_1 },
  ]);
  assert.equal(plan.matched, 1);
});

test("planCompanyFieldsBackfill never assigns a null/unmatched owner (deactivated or unknown HubSpot owner)", () => {
  const rows: CompanyFieldsBackfillRow[] = [
    { hubspotCompanyId: "1", companyKey: "acme", industry: null, city: null, country: null, ownerBdId: null },
  ];
  const existingByKey = new Map([["acme", existing()]]);
  const plan = planCompanyFieldsBackfill(rows, existingByKey);
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.skippedNoNewData, 1);
});
