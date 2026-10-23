import assert from "node:assert/strict";
import test from "node:test";
import { buildMemberAudience } from "@/lib/sequences/audienceView";

const base = { mobilePhone: null, phone: null, companyDecides: 0, colleagueCountries: [] };

test("own country: no phone hint, no company warning", () => {
  const a = buildMemberAudience({ ...base, personCountry: "Argentina", companyCountry: "United States", phone: "+54 223 632 4960", colleagueCountries: [{ country: "Argentina", n: 3 }] });
  assert.equal(a.reason, "person_country");
  assert.equal(a.iso, "AR");
  assert.equal(a.unusedPhone, null);
  assert.equal(a.companyImpact, null);
});

test("company country with colleagues elsewhere: impact counts only the contradicting ones", () => {
  const a = buildMemberAudience({ ...base, companyCountry: "United States", companyDecides: 103, colleagueCountries: [{ country: "Argentina", n: 3 }, { country: "USA", n: 9 }, { country: "Greater Buenos Aires", n: 4 }] });
  assert.deepEqual(a.companyImpact, { decides: 103, contradicting: 3, topCountry: "Argentina" });
});

test("company country with nobody contradicting: no warning", () => {
  const a = buildMemberAudience({ ...base, companyCountry: "United States", companyDecides: 5, colleagueCountries: [{ country: "United States", n: 2 }] });
  assert.equal(a.companyImpact, null);
});

test("the phone is surfaced only when it did not decide and its dial code places a country", () => {
  const unused = buildMemberAudience({ ...base, companyCountry: "United States", mobilePhone: "+54 223 632 4960" });
  assert.deepEqual(unused.unusedPhone, { number: "+54 223 632 4960", iso: "AR" });
  const garbage = buildMemberAudience({ ...base, companyCountry: "United States", mobilePhone: "12345" });
  assert.equal(garbage.unusedPhone, null);
  const decided = buildMemberAudience({ ...base, mobilePhone: "+54 223 632 4960" });
  assert.equal(decided.reason, "phone");
  assert.equal(decided.iso, "AR");
  assert.equal(decided.unusedPhone, null);
});

test("postings bucket names no country", () => {
  const a = buildMemberAudience({ ...base, postingMarkets: ["latam"], phone: "+54 223 632 4960" });
  assert.equal(a.reason, "posting_markets");
  assert.equal(a.iso, null);
  assert.equal(a.unusedPhone?.iso, "AR");
});

test("a HOLD keeps its reason", () => {
  const a = buildMemberAudience({ ...base, personCountry: "Greater Buenos Aires" });
  assert.equal(a.audience, null);
  assert.equal(a.reason, "person_country");
});
