import assert from "node:assert/strict";
import { test } from "node:test";
import { marketOfCountry, recipientMarket, type MarketInputs } from "../../src/lib/sequences/recipientMarket";
import { phoneCallingCodeGroups, phoneCountryName } from "../../src/lib/sequences/phoneMarket";

const market = (over: Partial<MarketInputs>) => recipientMarket({ mobilePhone: null, phone: null, ...over });

// Valid numbers per region (national significant parts chosen so libphonenumber accepts them).
const AR = "+5491155551234";
const ES = "+34612345678";
const DO_809 = "+18095551234";
const DO_829 = "+18295551234";
const DO_849 = "+18495551234";
const US_FL = "+13055551234";
const US_NY = "+12125551234";
const CA = "+14165550123";
const PR = "+17875551234";
const JM = "+18765551234";

test("link 4: a contact with no country and no postings resolves from the mobile's dial code", () => {
  assert.equal(market({ mobilePhone: AR }), "latam");
  assert.equal(market({ mobilePhone: ES }), "other");
  assert.equal(market({ phone: AR }), "latam");
});

test("a country that is present but unmapped decides `other` and never falls through to the phone", () => {
  assert.equal(market({ personCountry: "Spain", mobilePhone: AR }), "other");
  assert.equal(market({ companyCountry: "Spain", mobilePhone: AR, phone: AR }), "other");
  assert.equal(market({ personCountry: "Ireland", phone: US_FL }), "other");
});

test("a contact that resolves through links 1-3 is unchanged by any phone", () => {
  for (const phone of [AR, ES, US_FL, null]) {
    assert.equal(market({ personCountry: "United States", mobilePhone: phone }), "us");
    assert.equal(market({ personCountry: "Argentina", mobilePhone: phone }), "latam");
    assert.equal(market({ companyCountry: "Argentina", mobilePhone: phone }), "latam");
    assert.equal(market({ companyCountry: "United States", phone }), "us");
    assert.equal(market({ postingMarkets: ["us"], mobilePhone: phone }), "us");
    assert.equal(market({ postingMarkets: ["latam"], phone }), "latam");
  }
});

test("the phone decides only when the postings do not: none, all other, or a us/latam conflict", () => {
  assert.equal(market({ postingMarkets: ["other"], mobilePhone: AR }), "latam");
  assert.equal(market({ postingMarkets: ["us", "latam"], mobilePhone: US_FL }), "us");
  assert.equal(market({ postingMarkets: ["us", "latam"], mobilePhone: ES }), "other");
  assert.equal(market({ postingMarkets: [], mobilePhone: null }), "other");
});

test("+1809, +1829 and +1849 are the Dominican Republic (latam); the rest of +1 is us", () => {
  for (const n of [DO_809, DO_829, DO_849]) assert.equal(market({ mobilePhone: n }), "latam", n);
  for (const n of [US_FL, US_NY]) assert.equal(market({ mobilePhone: n }), "us", n);
  assert.equal(market({ mobilePhone: PR }), "other", "Puerto Rico has no footer until the owner decides its market and language");
});

test("Canada resolves us through the same rule as a Canadian country text, and Jamaica has no footer", () => {
  assert.equal(marketOfCountry("Canada"), "us");
  assert.equal(market({ mobilePhone: CA }), "us");
  assert.equal(market({ mobilePhone: JM }), "other");
});

test("a blank, unparseable or invalid phone leaves the contact blocked", () => {
  for (const bad of ["", "   ", "abc", "5491155551234", "+54", "+5491", "+999 123", "0054 9 11 5555 1234"]) {
    assert.equal(market({ mobilePhone: bad }), "other", JSON.stringify(bad));
  }
  assert.equal(phoneCountryName(null, null), null);
});

test("the mobile is preferred over the phone, and an unusable mobile falls back to the phone", () => {
  assert.equal(market({ mobilePhone: ES, phone: AR }), "other");
  assert.equal(market({ mobilePhone: AR, phone: ES }), "latam");
  assert.equal(market({ mobilePhone: "+54", phone: AR }), "latam");
  assert.equal(market({ mobilePhone: "", phone: US_FL }), "us");
});

test("Georgia (+995) is not read as the US state of the same name", () => {
  assert.equal(market({ mobilePhone: "+995 555 123 456" }), "other");
});

test("the resolver does not mutate its input and answers the same twice", () => {
  const input = Object.freeze({ mobilePhone: AR, phone: null, postingMarkets: Object.freeze(["us", "latam"]) });
  assert.equal(recipientMarket(input), recipientMarket(input));
  assert.deepEqual(input, { mobilePhone: AR, phone: null, postingMarkets: ["us", "latam"] });
});

test("the calling-code groups come from the same classification: longest LATAM prefixes under +1, bare 1 for the US", () => {
  const { latam, us } = phoneCallingCodeGroups(marketOfCountry);
  for (const code of ["54", "56", "55", "52", "57", "1809", "1829", "1849"]) assert.ok(latam.includes(code), code);
  assert.ok(!latam.includes("1"), "bare 1 is never LATAM: only the Dominican area codes are");
  assert.deepEqual(us, ["1"]);
  for (const out of ["34", "53", "995", "44"]) assert.ok(![...latam, ...us].includes(out), `${out} has no footer`);
});
