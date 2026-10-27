import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveComplianceAudience, type ComplianceAudienceInputs } from "../../src/lib/sequences/complianceAudience";
import { phoneCallingCodes, phoneCountryIso } from "../../src/lib/sequences/phoneMarket";

const audience = (over: Partial<ComplianceAudienceInputs>) => resolveComplianceAudience({ mobilePhone: null, phone: null, rosterCountries: [], ...over });

// Valid numbers per region (national significant parts chosen so libphonenumber accepts them).
const AR = "+5491155551234";
const ES = "+34612345678";
const DO_809 = "+18095551234";
const US_FL = "+13055551234";
const CA = "+14165550123";
const PR = "+17875551234";
const JM = "+18765551234";
const MDP = { address: "mdp", language: "es" } as const;
const MIAMI_ES = { address: "miami", language: "es" } as const;
const MIAMI_EN = { address: "miami", language: "en" } as const;

test("link 4: a contact with no country and no postings resolves from the mobile's dial code", () => {
  assert.deepEqual(audience({ mobilePhone: AR }), MDP);
  assert.deepEqual(audience({ mobilePhone: ES }), MIAMI_ES, "Spain was held under the market rule; it is mailable now");
  assert.deepEqual(audience({ phone: AR }), MDP);
});

test("a country that is present decides and never falls through to the phone", () => {
  assert.deepEqual(audience({ personCountry: "Spain", mobilePhone: AR }), MIAMI_ES);
  assert.deepEqual(audience({ companyCountry: "Ireland", phone: AR }), MIAMI_EN);
  assert.equal(audience({ personCountry: "Atlantis", mobilePhone: AR }), null);
});

test("the phone decides only when the postings do not: none, all other, or a us/latam conflict", () => {
  assert.deepEqual(audience({ postingMarkets: ["other"], mobilePhone: AR }), MDP);
  assert.deepEqual(audience({ postingMarkets: ["us", "latam"], mobilePhone: US_FL }), MIAMI_EN);
  assert.equal(audience({ postingMarkets: [], mobilePhone: null }), null);
});

test("every +1 number is located: the Dominican Republic is Spanish, the US, Canada, Puerto Rico and Jamaica follow their own language", () => {
  assert.deepEqual(audience({ mobilePhone: DO_809 }), MIAMI_ES);
  assert.deepEqual(audience({ mobilePhone: US_FL }), MIAMI_EN);
  assert.deepEqual(audience({ mobilePhone: CA }), MIAMI_EN);
  assert.deepEqual(audience({ mobilePhone: PR }), MIAMI_ES);
  assert.deepEqual(audience({ mobilePhone: JM }), MIAMI_EN);
});

test("a blank, unparseable or invalid phone leaves the contact blocked", () => {
  for (const bad of ["", "   ", "abc", "5491155551234", "+54", "+5491", "+999 123", "0054 9 11 5555 1234"]) {
    assert.equal(audience({ mobilePhone: bad }), null, JSON.stringify(bad));
  }
  assert.equal(phoneCountryIso(null, null), null);
});

test("the mobile is preferred over the phone, and an unusable mobile falls back to the phone", () => {
  assert.deepEqual(audience({ mobilePhone: ES, phone: AR }), MIAMI_ES);
  assert.deepEqual(audience({ mobilePhone: AR, phone: ES }), MDP);
  assert.deepEqual(audience({ mobilePhone: "+54", phone: AR }), MDP);
  assert.deepEqual(audience({ mobilePhone: "", phone: US_FL }), MIAMI_EN);
});

test("Georgia (+995) is a located country: Miami in English, the same answer as the US state of that name", () => {
  assert.deepEqual(audience({ mobilePhone: "+995 555 123 456" }), MIAMI_EN);
});

test("the resolver does not mutate its input and answers the same twice", () => {
  const input = Object.freeze({ mobilePhone: AR, phone: null, rosterCountries: [], postingMarkets: Object.freeze(["us", "latam"]) });
  assert.deepEqual(resolveComplianceAudience(input), resolveComplianceAudience(input));
  assert.deepEqual(input, { mobilePhone: AR, phone: null, rosterCountries: [], postingMarkets: ["us", "latam"] });
});

test("the calling-code list is every country's code, once, with the bare NANP 1 and no area-code splits", () => {
  const codes = phoneCallingCodes();
  for (const code of ["1", "34", "44", "53", "54", "55", "66", "98", "995"]) assert.ok(codes.includes(code), code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(!codes.some((c) => c.startsWith("1") && c.length > 2 && c.length === 4), "no 1809-style area-code prefixes: bare 1 covers them");
  assert.ok(codes.length > 150);
  // Prefix-free: a prefix test can never confuse two countries.
  for (const a of codes) for (const b of codes) if (a !== b) assert.ok(!b.startsWith(a), `${a} is a prefix of ${b}`);
});
