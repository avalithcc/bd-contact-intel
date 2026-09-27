/**
 * Unit tests for src/lib/companies/listMappers.ts — pure mappers for the
 * `/companies` list rebuild (mockups/companies.html): stage badge tone,
 * the Vacantes column's "N vacantes de IT" label, and the pending-D1 seam
 * (industry/owner/location) that shows "—" until the parallel data branch
 * (feat/company-fields-01…) adds those columns.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  industryLabel,
  locationLabel,
  ownerLabel,
  stageBadgeClass,
  vacantesLabel,
} from "@/lib/companies/listMappers";

test("stageBadgeClass: maps each known relationship stage to its mockup badge tone", () => {
  assert.equal(stageBadgeClass("qualified"), "badge badge-info");
  assert.equal(stageBadgeClass("proposal_sent"), "badge badge-warn");
  assert.equal(stageBadgeClass("won"), "badge badge-success");
  assert.equal(stageBadgeClass("lost"), "badge badge-outline");
  assert.equal(stageBadgeClass("prospect"), "badge badge-neutral");
});

test("stageBadgeClass: falls back to the neutral tone for an unknown or missing stage", () => {
  assert.equal(stageBadgeClass(null), "badge badge-neutral");
  assert.equal(stageBadgeClass("something_new"), "badge badge-neutral");
});

test("vacantesLabel: returns null with no open IT postings, so the caller renders the mockup's em-dash", () => {
  assert.equal(vacantesLabel(0), null);
  assert.equal(vacantesLabel(undefined), null);
});

test("vacantesLabel: pluralizes correctly", () => {
  assert.equal(vacantesLabel(1), "1 vacante de IT");
  assert.equal(vacantesLabel(38), "38 vacantes de IT");
});

// D1 (owner-approved 2026-09-26): company.industry/owner_bd_id/city/country
// are being added by a parallel data branch (feat/company-fields-01…, from
// the same base commit). These mappers are the seam — they already read the
// optional fields and show "—" until that branch merges and the list/record
// queries start populating them.
test("pending-D1 mappers: show the em-dash placeholder when the field is absent", () => {
  assert.equal(industryLabel({}), "—");
  assert.equal(ownerLabel({}), "—");
  assert.equal(locationLabel({}), "—");
});

test("pending-D1 mappers: render the real value once present", () => {
  assert.equal(industryLabel({ industry: "E-commerce" }), "E-commerce");
  assert.equal(ownerLabel({ ownerName: "Ana Pereyra" }), "Ana Pereyra");
  assert.equal(locationLabel({ city: "Buenos Aires", country: "Argentina" }), "Buenos Aires, Argentina");
});

test("locationLabel: joins only the parts of a location that are present", () => {
  assert.equal(locationLabel({ city: "Buenos Aires" }), "Buenos Aires");
  assert.equal(locationLabel({ country: "Argentina" }), "Argentina");
  assert.equal(locationLabel({ city: "  ", country: null }), "—");
});
