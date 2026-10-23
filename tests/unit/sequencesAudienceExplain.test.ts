import assert from "node:assert/strict";
import test from "node:test";
import { explainComplianceAudience, resolveComplianceAudience, type ComplianceAudienceInputs } from "@/lib/sequences/complianceAudience";

const none = { mobilePhone: null, phone: null };

test("person country decides and is quoted back", () => {
  const e = explainComplianceAudience({ ...none, personCountry: "Argentina", companyCountry: "United States" });
  assert.deepEqual(e, { audience: { address: "mdp", language: "es" }, reason: "person_country", evidence: "Argentina" });
});

test("company country decides when the person has none", () => {
  const e = explainComplianceAudience({ ...none, personCountry: "  ", companyCountry: "United States" });
  assert.deepEqual(e, { audience: { address: "miami", language: "en" }, reason: "company_country", evidence: "United States" });
});

test("posting markets decide when no country is filed", () => {
  const e = explainComplianceAudience({ ...none, postingMarkets: ["latam"] });
  assert.deepEqual(e, { audience: { address: "miami", language: "es" }, reason: "posting_markets", evidence: "latam" });
});

test("the phone decides last", () => {
  const e = explainComplianceAudience({ mobilePhone: "+54 223 632 4960", phone: null });
  assert.equal(e.reason, "phone");
  assert.equal(e.evidence, "+54 223 632 4960");
  assert.deepEqual(e.audience, { address: "mdp", language: "es" });
});

test("an unrecognised country HOLDS and still names the link that decided", () => {
  const e = explainComplianceAudience({ ...none, personCountry: "Greater Buenos Aires", companyCountry: "Argentina" });
  assert.deepEqual(e, { audience: null, reason: "person_country", evidence: "Greater Buenos Aires" });
});

test("a sanctioned company country holds with its reason", () => {
  const e = explainComplianceAudience({ ...none, companyCountry: "Cuba" });
  assert.deepEqual(e, { audience: null, reason: "company_country", evidence: "Cuba" });
});

test("no link had data: audience and reason are both null", () => {
  assert.deepEqual(explainComplianceAudience(none), { audience: null, reason: null, evidence: null });
  assert.deepEqual(explainComplianceAudience({ ...none, postingMarkets: ["other", null] }), { audience: null, reason: null, evidence: null });
});

test("anti-drift: resolveComplianceAudience is exactly the audience of the explainer", () => {
  const table: ComplianceAudienceInputs[] = [
    none,
    { ...none, personCountry: "Argentina" },
    { ...none, personCountry: "Spain", companyCountry: "Argentina" },
    { ...none, personCountry: "Greater Buenos Aires", companyCountry: "Argentina" },
    { ...none, companyCountry: "United States" },
    { ...none, companyCountry: "Cuba" },
    { ...none, companyCountry: "Miami, FL", postingMarkets: ["us"] },
    { ...none, postingMarkets: ["us"] },
    { ...none, postingMarkets: ["latam"] },
    { ...none, postingMarkets: ["us", "latam"], phone: "+54 223 632 4960" },
    { mobilePhone: "+1 305 555 0100", phone: null },
    { mobilePhone: "+54 223 632 4960", phone: "+1 305 555 0100" },
    { mobilePhone: "garbage", phone: null },
    { ...none, personCountry: "   ", companyCountry: "" },
  ];
  for (const i of table) assert.deepEqual(resolveComplianceAudience(i), explainComplianceAudience(i).audience, JSON.stringify(i));
});
