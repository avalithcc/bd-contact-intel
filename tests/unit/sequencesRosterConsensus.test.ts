import assert from "node:assert/strict";
import test from "node:test";
import { explainComplianceAudience, resolveComplianceAudience, type ColleagueCountry, type ComplianceAudienceInputs } from "@/lib/sequences/complianceAudience";

const base = { mobilePhone: null, phone: null, rosterCountries: [] as ColleagueCountry[] };
const roster = (...pairs: [string, number][]): ColleagueCountry[] => pairs.map(([country, n]) => ({ country, n }));
const MDP_ES = { address: "mdp", language: "es" };
const MIAMI_EN = { address: "miami", language: "en" };

test("a strict majority of colleagues decides over the company country (the Globant case)", () => {
  const e = explainComplianceAudience({ ...base, companyCountry: "United States", rosterCountries: roster(["Argentina", 5], ["United States", 1]) });
  assert.equal(e.reason, "roster_consensus");
  assert.equal(e.evidence, "AR");
  assert.deepEqual(e.audience, MDP_ES);
  assert.deepEqual(e.colleagues, { agree: 5, of: 6 });
});

test("the person's own country still comes first", () => {
  const e = explainComplianceAudience({ ...base, personCountry: "United States", rosterCountries: roster(["Argentina", 9]) });
  assert.equal(e.reason, "person_country");
  assert.deepEqual(e.audience, MIAMI_EN);
});

test("the roster outranks the company country even with no company country at all", () => {
  const e = explainComplianceAudience({ ...base, rosterCountries: roster(["Argentina", 2]) });
  assert.equal(e.reason, "roster_consensus");
  assert.deepEqual(e.audience, MDP_ES);
});

test("one colleague is not a consensus", () => {
  const e = explainComplianceAudience({ ...base, rosterCountries: roster(["Argentina", 1]) });
  assert.deepEqual(e.audience, null);
  assert.equal(e.reason, null);
  assert.equal(e.colleaguesDisagree, undefined);
});

test("exactly half is not a strict majority: the company country still decides, and the dissent is flagged", () => {
  const e = explainComplianceAudience({ ...base, companyCountry: "United States", rosterCountries: roster(["Argentina", 2], ["Chile", 2]) });
  assert.equal(e.reason, "company_country");
  assert.deepEqual(e.audience, MIAMI_EN);
  assert.equal(e.colleaguesDisagree, true);
});

test("without a company country a split roster answers nothing by itself", () => {
  const e = explainComplianceAudience({ ...base, rosterCountries: roster(["Argentina", 2], ["Chile", 2]) });
  assert.deepEqual(e, { audience: null, reason: null, evidence: null, colleaguesDisagree: true });
});

test("filed spellings of one country are tallied together", () => {
  const e = explainComplianceAudience({ ...base, rosterCountries: roster(["Argentina", 1], ["argentina", 1], ["USA", 1]) });
  assert.equal(e.evidence, "AR");
  assert.deepEqual(e.colleagues, { agree: 2, of: 3 });
});

test("colleagues whose country text is not a country are not counted at all", () => {
  const e = explainComplianceAudience({ ...base, rosterCountries: roster(["Argentina", 2], ["Greater Buenos Aires", 10]) });
  assert.equal(e.reason, "roster_consensus");
  assert.deepEqual(e.colleagues, { agree: 2, of: 2 });
});

test("a sanctioned majority HOLDS: the roster never routes around an embargo", () => {
  const e = explainComplianceAudience({ ...base, companyCountry: "United States", phone: "+1 305 555 0100", rosterCountries: roster(["Cuba", 3], ["Argentina", 1]) });
  assert.equal(e.audience, null);
  assert.equal(e.reason, "roster_consensus");
  assert.equal(e.evidence, "CU");
});

test("one colleague that agrees with the company leaves the company country in charge", () => {
  const e = explainComplianceAudience({ ...base, companyCountry: "United States", rosterCountries: roster(["USA", 1]) });
  assert.equal(e.reason, "company_country");
  assert.deepEqual(e.audience, MIAMI_EN);
  assert.equal(e.colleaguesDisagree, undefined);
});

test("a colleague who contradicts the company country does not take it away: no majority, so the company decides, flagged", () => {
  const e = explainComplianceAudience({ ...base, companyCountry: "United States", mobilePhone: "+54 223 632 4960", postingMarkets: ["latam"], rosterCountries: roster(["Argentina", 1]) });
  assert.equal(e.reason, "company_country");
  assert.deepEqual(e.audience, MIAMI_EN);
  assert.equal(e.colleaguesDisagree, true);
});

test("the Rappi shape: company Colombia, two colleagues elsewhere and apart, stays Spanish via the company, flagged", () => {
  const e = explainComplianceAudience({ ...base, companyCountry: "Colombia", rosterCountries: roster(["Argentina", 1], ["Mexico", 1]) });
  assert.equal(e.reason, "company_country");
  assert.deepEqual(e.audience, { address: "miami", language: "es" });
  assert.equal(e.evidence, "Colombia");
  assert.equal(e.colleaguesDisagree, true);
});

test("a company country that is a sanctioned jurisdiction still holds even when colleagues dissent", () => {
  const e = explainComplianceAudience({ ...base, companyCountry: "Cuba", rosterCountries: roster(["Argentina", 1]) });
  assert.deepEqual(e, { audience: null, reason: "company_country", evidence: "Cuba", colleaguesDisagree: true });
});

test("only a split roster WITHOUT a company country falls through to postings, then phone, and says the colleagues disagree", () => {
  const input = { ...base, rosterCountries: roster(["Argentina", 1], ["Chile", 1]) };
  const held = explainComplianceAudience(input);
  assert.equal(held.audience, null);
  assert.equal(held.reason, null);
  assert.equal(held.colleaguesDisagree, true);
  const viaPostings = explainComplianceAudience({ ...input, postingMarkets: ["latam"] });
  assert.equal(viaPostings.reason, "posting_markets");
  assert.equal(viaPostings.colleaguesDisagree, true);
  const viaPhone = explainComplianceAudience({ ...input, mobilePhone: "+54 223 632 4960" });
  assert.equal(viaPhone.reason, "phone");
  assert.deepEqual(viaPhone.audience, MDP_ES);
});

test("a contradicted company country that is unrecognised text still cannot be compared, so it keeps holding", () => {
  const e = explainComplianceAudience({ ...base, companyCountry: "Miami, FL", rosterCountries: roster(["Argentina", 1]) });
  assert.deepEqual(e, { audience: null, reason: "company_country", evidence: "Miami, FL" });
});

test("an unrecognised company text yields to a colleague majority", () => {
  const e = explainComplianceAudience({ ...base, companyCountry: "Miami, FL", rosterCountries: roster(["Argentina", 3]) });
  assert.equal(e.reason, "roster_consensus");
});

test("a mixed roster with no company country falls to the postings and says the colleagues disagree", () => {
  const e = explainComplianceAudience({ ...base, postingMarkets: ["latam"], rosterCountries: roster(["Argentina", 1], ["Chile", 1], ["Peru", 1]) });
  assert.equal(e.reason, "posting_markets");
  assert.equal(e.colleaguesDisagree, true);
});

test("a malformed count is ignored, never trusted", () => {
  const e = explainComplianceAudience({ ...base, rosterCountries: roster(["Argentina", 2], ["Chile", Number.NaN], ["Peru", -4], ["Brazil", 0]) });
  assert.equal(e.reason, "roster_consensus");
  assert.deepEqual(e.colleagues, { agree: 2, of: 2 });
});

test("pure: the same input twice gives the same answer and the input is never touched", () => {
  const input: ComplianceAudienceInputs = Object.freeze({
    ...base,
    companyCountry: "United States",
    postingMarkets: Object.freeze(["us"]),
    rosterCountries: Object.freeze([Object.freeze({ country: "Argentina", n: 3 }), Object.freeze({ country: "Chile", n: 1 })]),
  });
  const before = JSON.stringify(input);
  const first = explainComplianceAudience(input);
  const second = explainComplianceAudience(input);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(input), before);
});

test("anti-drift: resolveComplianceAudience is exactly the audience of the explainer, rosters included", () => {
  const table: ComplianceAudienceInputs[] = [
    base,
    { ...base, rosterCountries: roster(["Argentina", 3]) },
    { ...base, companyCountry: "United States", rosterCountries: roster(["Argentina", 3], ["Chile", 1]) },
    { ...base, companyCountry: "United States", rosterCountries: roster(["Argentina", 1]) },
    { ...base, rosterCountries: roster(["Cuba", 2]) },
    { ...base, rosterCountries: roster(["Argentina", 1], ["Chile", 1]), postingMarkets: ["us"] },
  ];
  for (const i of table) assert.deepEqual(resolveComplianceAudience(i), explainComplianceAudience(i).audience, JSON.stringify(i));
});
