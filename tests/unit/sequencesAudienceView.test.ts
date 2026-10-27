import assert from "node:assert/strict";
import test from "node:test";
import { buildMemberAudience } from "@/lib/sequences/audienceView";
import { fixMenuItems, formatColleagueBreakdown } from "@/lib/sequences/audienceCard";

const base = { mobilePhone: null, phone: null, rosterCountries: [] };
const roster = (...pairs: [string, number][]) => pairs.map(([country, n]) => ({ country, n }));

test("own country: no phone hint", () => {
  const a = buildMemberAudience({ ...base, personCountry: "Argentina", companyCountry: "United States", phone: "+54 223 632 4960", rosterCountries: roster(["Argentina", 3]) });
  assert.equal(a.reason, "person_country");
  assert.equal(a.iso, "AR");
  assert.equal(a.unusedPhone, null);
});

test("roster consensus names its country and its colleagues, and never surfaces the phone", () => {
  const a = buildMemberAudience({ ...base, companyCountry: "United States", mobilePhone: "+1 305 555 0100", rosterCountries: roster(["Argentina", 12], ["Chile", 2]) });
  assert.equal(a.reason, "roster_consensus");
  assert.equal(a.iso, "AR");
  assert.deepEqual(a.colleagues, { agree: 12, of: 14 });
  assert.equal(a.unusedPhone, null);
  assert.equal(a.isoName, "Argentina");
  assert.equal(a.companyIgnored, "United States", "the card says the filed company country was set aside");
  assert.equal(buildMemberAudience({ ...base, companyCountry: "Argentina", rosterCountries: roster(["Argentina", 3]) }).companyIgnored, null, "a company country the roster agrees with was not set aside");
});

test("company country with colleagues that agree reports how many colleagues know a country", () => {
  const a = buildMemberAudience({ ...base, companyCountry: "United States", rosterCountries: roster(["USA", 1]) });
  assert.equal(a.reason, "company_country");
  assert.equal(a.colleaguesKnown, 1);
  assert.equal(a.colleaguesDisagree, undefined);
});

test("a split roster carries its breakdown by ISO, biggest first, unrecognised texts left out", () => {
  const a = buildMemberAudience({ ...base, companyCountry: "United States", mobilePhone: "+54 223 632 4960", rosterCountries: roster(["Mexico", 4], ["Argentina", 4], ["Greater Buenos Aires", 9], ["Chile", 3]) });
  assert.equal(a.reason, "phone");
  assert.equal(a.colleaguesDisagree, true);
  assert.equal(a.companyIgnored, "United States");
  assert.deepEqual(a.colleagueCountries, [{ iso: "AR", n: 4, name: "Argentina" }, { iso: "MX", n: 4, name: "México" }, { iso: "CL", n: 3, name: "Chile" }]);
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

test("a sanctioned roster majority HOLDS with its ISO, so the card can say it is an embargo", () => {
  const a = buildMemberAudience({ ...base, rosterCountries: roster(["Cuba", 3]) });
  assert.equal(a.audience, null);
  assert.equal(a.reason, "roster_consensus");
  assert.equal(a.iso, "CU");
});

test("the breakdown reads 'A (4) y B (4)' and 'A (4), B (4) y C (3)', biggest first then by name", () => {
  const and = "y";
  assert.equal(formatColleagueBreakdown([{ name: "México", n: 4 }, { name: "Argentina", n: 4 }], and), "Argentina (4) y México (4)");
  assert.equal(formatColleagueBreakdown([{ name: "Chile", n: 3 }, { name: "México", n: 4 }, { name: "Argentina", n: 4 }], and), "Argentina (4), México (4) y Chile (3)");
  assert.equal(formatColleagueBreakdown([{ name: "Perú", n: 2 }], and), "Perú (2)");
  assert.equal(formatColleagueBreakdown([], and), "");
  assert.equal(formatColleagueBreakdown([{ name: "Argentina", n: 1 }, { name: "Brasil", n: 1 }], "and"), "Argentina (1) and Brasil (1)");
});

test("the breakdown does not reorder the list it is given", () => {
  const input = Object.freeze([Object.freeze({ name: "México", n: 4 }), Object.freeze({ name: "Argentina", n: 4 })]);
  assert.equal(formatColleagueBreakdown(input, "y"), formatColleagueBreakdown(input, "y"));
  assert.equal(input[0].name, "México");
});

// The "corregir" menu per state, approved with the mockup (2026-10-27).
const items = (raw: Parameters<typeof buildMemberAudience>[0], hasCompany = true) => fixMenuItems(buildMemberAudience(raw), hasCompany);

test("menu: roster consensus offers only the person's country and the colleagues", () => {
  assert.deepEqual(items({ ...base, companyCountry: "United States", rosterCountries: roster(["Argentina", 5]) }), ["person", "colleagues"]);
});

test("menu: company country is unchanged (person, company, phone) when nobody contradicts it", () => {
  assert.deepEqual(items({ ...base, companyCountry: "United States", rosterCountries: roster(["USA", 1]) }), ["person", "company", "phone"]);
  assert.deepEqual(items({ ...base, companyCountry: "United States", mobilePhone: "+54 223 632 4960" }), ["person", "company"], "the shipped rule: a phone already on file is not asked for again");
});

test("menu: phone after a split roster offers person, company and the colleagues, not the phone", () => {
  assert.deepEqual(items({ ...base, companyCountry: "United States", mobilePhone: "+54 223 632 4960", rosterCountries: roster(["Argentina", 4], ["Mexico", 4]) }), ["person", "company", "colleagues"]);
});

test("menu: a HOLD with a split roster offers all three fixes and the colleagues", () => {
  const raw = { ...base, rosterCountries: roster(["Argentina", 4], ["Mexico", 4]) };
  assert.equal(buildMemberAudience(raw).audience, null);
  assert.deepEqual(items(raw), ["person", "company", "phone", "colleagues"]);
});

test("menu: no company on the card means no company items", () => {
  assert.deepEqual(items({ ...base, rosterCountries: roster(["Argentina", 5]) }, false), ["person"]);
  assert.deepEqual(items({ ...base, rosterCountries: roster(["Argentina", 4], ["Mexico", 4]) }, false), ["person", "phone"]);
});

test("menu: with the person country decided the card hides the menu; the items left are the shipped ones", () => {
  assert.deepEqual(items({ ...base, personCountry: "Argentina" }), ["company", "phone"]);
});
