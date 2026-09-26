/**
 * Unit tests for src/lib/hubspot/refill.ts — the pure re-import "fill empty
 * fields only" planner (design D4 "Re-import (R7/Q3)", task 3.8). Precisely
 * distinct from R7 (src/lib/identity/matcher.ts's mergeProperty/live-path
 * mergeFields): R7 lets a MORE SPECIFIC incoming value win even when the
 * existing value is non-empty; planHubSpotRefill NEVER touches a
 * non-empty existing field, on re-import or otherwise.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planHubSpotRefill,
  type HubSpotRefillExistingPerson,
  type HubSpotRefillIncoming,
} from "@/lib/hubspot/refill";

function existing(overrides: Partial<HubSpotRefillExistingPerson> = {}): HubSpotRefillExistingPerson {
  return {
    id: "person-1",
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
    ...overrides,
  };
}

function incoming(overrides: Partial<HubSpotRefillIncoming> = {}): HubSpotRefillIncoming {
  return {
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
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    ...overrides,
  };
}

test("fills an empty jobTitle from the incoming row and records history with source 'import'", () => {
  const plan = planHubSpotRefill(existing({ jobTitle: null }), incoming({ jobTitle: "VP of Engineering" }));
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate!.jobTitle, "VP of Engineering");
  const row = plan.historyRows.find((r) => r.property === "jobTitle")!;
  assert.equal(row.oldValue, null);
  assert.equal(row.newValue, "VP of Engineering");
  assert.equal(row.source, "import");
  assert.equal(row.changedByBdId, null);
});

test("NEVER overwrites a non-empty existing field, even with a more specific/longer incoming value (distinct from R7)", () => {
  const plan = planHubSpotRefill(existing({ jobTitle: "VP" }), incoming({ jobTitle: "VP of Engineering, EMEA" }));
  assert.equal(plan.changed, false);
  assert.equal(plan.personUpdate, null);
  assert.equal(plan.historyRows.length, 0);
});

test("fills city/country/company/companyKey/industry/ownerBdId independently, only when each is empty", () => {
  const plan = planHubSpotRefill(
    existing({ city: null, country: "Argentina", company: null, companyKey: null, industry: null, ownerBdId: "bd-existing" }),
    incoming({ city: "CABA", country: "Uruguay", company: "Acme", companyKey: "acme", industry: "SaaS", ownerBdId: "bd-new" }),
  );
  assert.equal(plan.personUpdate!.city, "CABA");
  assert.equal(plan.personUpdate!.country, undefined);
  assert.equal(plan.personUpdate!.company, "Acme");
  assert.equal(plan.personUpdate!.companyKey, "acme");
  assert.equal(plan.personUpdate!.industry, "SaaS");
  assert.equal(plan.personUpdate!.ownerBdId, undefined);
  const properties = plan.historyRows.map((r) => r.property).sort();
  assert.deepEqual(properties, ["city", "company", "companyKey", "industry"]);
});

test("email fields move together as one unit — fills only when the existing email is empty", () => {
  const plan = planHubSpotRefill(
    existing({ email: null, emailNormalized: null, emailStatus: "none", emailSource: null }),
    incoming({ email: "Jane@Acme.com", emailStatus: "probable", emailSource: "hubspot_import" }),
  );
  assert.equal(plan.personUpdate!.email, "Jane@Acme.com");
  assert.equal(plan.personUpdate!.emailNormalized, "jane@acme.com");
  assert.equal(plan.personUpdate!.emailStatus, "probable");
  assert.equal(plan.personUpdate!.emailSource, "hubspot_import");
  const properties = plan.historyRows.map((r) => r.property).sort();
  assert.deepEqual(properties, ["email", "emailNormalized", "emailSource", "emailStatus"]);
});

test("an existing email (any status) is never replaced, even by a HubSpot email", () => {
  const plan = planHubSpotRefill(
    existing({ email: "jane@old.com", emailNormalized: "jane@old.com", emailStatus: "probable", emailSource: "csv" }),
    incoming({ email: "jane@hubspot.com", emailStatus: "probable", emailSource: "hubspot_import" }),
  );
  assert.equal(plan.personUpdate, null);
  assert.equal(plan.changed, false);
});

test("no-op refill (nothing empty, nothing to fill) reports changed:false and writes no history", () => {
  const plan = planHubSpotRefill(
    existing({ firstName: "Jane", lastName: "Doe", jobTitle: "VP", email: "jane@acme.com", emailStatus: "verified" }),
    incoming({ firstName: "Jane", lastName: "Doe", jobTitle: "Someone Else", email: "jane@hubspot.com", emailStatus: "probable" }),
  );
  assert.equal(plan.changed, false);
  assert.equal(plan.historyRows.length, 0);
});

test("an incoming blank/null value never fills anything (nothing to fill from)", () => {
  const plan = planHubSpotRefill(existing({ jobTitle: null }), incoming({ jobTitle: null }));
  assert.equal(plan.changed, false);
});
