import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { getCountries, getExampleNumber, type CountryCode } from "libphonenumber-js";
import examples from "libphonenumber-js/examples.mobile.json" with { type: "json" };
import {
  AMBIGUOUS_NAMES,
  RECOGNIZED_COUNTRIES,
  SANCTIONED_COUNTRIES,
  SPANISH_SPEAKING_COUNTRIES,
  resolveComplianceAudience,
  resolveCountry,
  type ComplianceAudienceInputs,
} from "../../src/lib/sequences/complianceAudience";
import { countryNameOf, phoneCountryIso } from "../../src/lib/sequences/phoneMarket";
import { LATAM_COUNTRY_NAMES } from "../../src/lib/hiring/markets";
import { recipientMarket } from "../../src/lib/sequences/recipientMarket";

const audience = (over: Partial<ComplianceAudienceInputs>) =>
  resolveComplianceAudience({ mobilePhone: null, phone: null, ...over });

const AR_PHONE = "+5491155551234";
const ES_PHONE = "+34612345678";
const MDP = { address: "mdp", language: "es" } as const;
const MIAMI_ES = { address: "miami", language: "es" } as const;
const MIAMI_EN = { address: "miami", language: "en" } as const;

test("Argentina resolves to Mar del Plata from each country link", () => {
  assert.deepEqual(audience({ personCountry: "Argentina" }), MDP);
  assert.deepEqual(audience({ companyCountry: "Argentina" }), MDP);
  assert.deepEqual(audience({ mobilePhone: AR_PHONE }), MDP);
  assert.deepEqual(audience({ phone: AR_PHONE }), MDP);
});

test("a latam posting bucket never yields Mar del Plata: Argentina is unprovable from a bucket", () => {
  assert.deepEqual(audience({ postingMarkets: ["latam"] }), MIAMI_ES);
  assert.deepEqual(audience({ postingMarkets: ["latam", "latam"] }), MIAMI_ES);
});

test("a us posting bucket yields Miami in English", () => {
  assert.deepEqual(audience({ postingMarkets: ["us"] }), MIAMI_EN);
});

test("postings that conflict or say nothing fall through to the phone, as recipientMarket does", () => {
  assert.deepEqual(audience({ postingMarkets: ["us", "latam"], mobilePhone: AR_PHONE }), MDP);
  assert.deepEqual(audience({ postingMarkets: ["other", null], phone: ES_PHONE }), MIAMI_ES);
  assert.equal(audience({ postingMarkets: ["us", "latam"] }), null);
  assert.equal(audience({ postingMarkets: ["other", null, "bogus"] }), null);
});

test("chain order: person beats company beats postings beats phone", () => {
  const all = { companyCountry: "Spain", postingMarkets: ["us"], mobilePhone: AR_PHONE };
  assert.deepEqual(audience({ ...all, personCountry: "Ireland" }), MIAMI_EN);
  assert.deepEqual(audience(all), MIAMI_ES);
  assert.deepEqual(audience({ postingMarkets: ["us"], mobilePhone: AR_PHONE }), MIAMI_EN);
  assert.deepEqual(audience({ personCountry: "   ", companyCountry: "Argentina" }), MDP);
});

test("a present but unrecognized country decides and holds; it does not fall through to a phone", () => {
  assert.equal(audience({ personCountry: "Atlantis", mobilePhone: AR_PHONE }), null);
});

test("Puerto Rico is Spanish-speaking (owner decision 2026-10-20): es", () => {
  assert.deepEqual(audience({ personCountry: "Puerto Rico" }), MIAMI_ES);
});

test("Brazil is English (owner decision 2026-10-20, explicitly NOT Portuguese): en, and never pt", () => {
  assert.deepEqual(audience({ personCountry: "Brazil" }), MIAMI_EN);
  assert.deepEqual(audience({ personCountry: "Brasil" }), MIAMI_EN);
  assert.deepEqual(audience({ mobilePhone: "+5511912345678" }), MIAMI_EN);
});

test("hand-written aliases resolve to the intended country", () => {
  const expected: Array<[string, string]> = [["USA", "US"], ["U.S.", "US"], ["UK", "GB"], ["Brasil", "BR"], ["República Dominicana", "DO"], ["Holanda", "NL"], ["Turkey", "TR"], ["Czech Republic", "CZ"], ["Hong Kong", "HK"]];
  for (const [text, iso] of expected) assert.equal(resolveCountry(text), iso, text);
});

test("the output language is never pt for any recognized country", () => {
  for (const { names } of RECOGNIZED_COUNTRIES) {
    for (const alias of names) {
      const result = audience({ personCountry: alias });
      if (result) assert.notEqual(result.language, "pt", alias);
    }
  }
});

test("Spain is Miami in Spanish; other European countries are Miami in English", () => {
  assert.deepEqual(audience({ personCountry: "Spain" }), MIAMI_ES);
  for (const country of ["Ireland", "Italy", "Germany", "United Kingdom", "Netherlands", "France", "Israel", "Poland", "Canada", "United States"]) {
    assert.deepEqual(audience({ personCountry: country }), MIAMI_EN, country);
  }
});

test("sanctioned jurisdictions hold: a US entity's postal footer on mail there is an unanswered OFAC question", () => {
  for (const country of ["Cuba", "Iran", "North Korea", "Syria"]) {
    const why = `${country} must hold (null), never receive the Miami address: sanctions posture, owner has not decided`;
    assert.equal(audience({ personCountry: country }), null, why);
    assert.equal(audience({ companyCountry: country }), null, why);
  }
  assert.equal(audience({ mobilePhone: "+5351234567" }), null, "a Cuban phone holds");
  assert.equal(audience({ mobilePhone: "+989121234567" }), null, "an Iranian phone holds");
  assert.deepEqual([...SANCTIONED_COUNTRIES].sort(), ["CU", "IR", "KP", "SY"]);
});

test("no signal at all holds", () => {
  assert.equal(audience({}), null);
  assert.equal(audience({ personCountry: "", companyCountry: "  ", postingMarkets: [], mobilePhone: "", phone: "garbage" }), null);
  assert.equal(audience({ postingMarkets: null }), null);
});

test("exact match only: look-alikes and cities do not resolve to a country", () => {
  for (const text of ["Greater Buenos Aires", "Miami, FL", "New Mexico", "Canada Bay, Australia", "Buenos Aires", "Spain and Portugal"]) {
    assert.equal(resolveCountry(text), null, text);
    assert.equal(audience({ personCountry: text }), null, `${text} must hold, not guess a country`);
  }
});

test("alias spellings, case, diacritics and whitespace resolve to the same country", () => {
  const same: Array<[string, string]> = [
    ["España", "Spain"],
    ["México", "Mexico"],
    ["Brasil", "Brazil"],
    ["Perú", "Peru"],
    ["Panamá", "Panama"],
    ["República Dominicana", "Dominican Republic"],
    ["  ARGENTINA ", "argentina"],
    ["Costa   Rica", "costa rica"],
    ["EE. UU.", "United States"],
    ["U.S.A.", "usa"],
    ["Canadá", "Canada"],
    ["Reino Unido", "UK"],
  ];
  for (const [a, b] of same) {
    assert.ok(resolveCountry(a), a);
    assert.equal(resolveCountry(a), resolveCountry(b), `${a} vs ${b}`);
  }
});

test("every Spanish-speaking country resolves to es", () => {
  for (const iso of SPANISH_SPEAKING_COUNTRIES) {
    const entry = RECOGNIZED_COUNTRIES.find((c) => c.iso === iso);
    assert.ok(entry, `${iso} must be a recognized country`);
    const result = audience({ personCountry: entry.names[0] });
    // Cuba is Spanish-speaking AND sanctioned: it holds, so there is no audience to carry a language.
    if (SANCTIONED_COUNTRIES.has(iso)) {
      assert.equal(result, null, iso);
      continue;
    }
    assert.equal(result?.language, "es", iso);
    assert.equal(result?.address, iso === "AR" ? "mdp" : "miami", iso);
  }
});

test("the Spanish-speaking set is exactly these 21 states, spelled out", () => {
  // Written in literals ON PURPOSE. Every other assertion about language in this file derives its expectation from
  // SPANISH_SPEAKING_COUNTRIES, so swapping one member for a wrong one (Bolivia out, Georgia in) keeps the size at 21
  // and passes all of them. A test that reads the policy set it is checking cannot catch a bad edit of that set, so the
  // policy is restated here by hand. The same reasoning is why the sanctioned jurisdictions have a literals test.
  assert.deepEqual(
    [...SPANISH_SPEAKING_COUNTRIES].sort(),
    ["AR", "BO", "CL", "CO", "CR", "CU", "DO", "EC", "ES", "GQ", "GT", "HN", "MX", "NI", "PA", "PE", "PR", "PY", "SV", "UY", "VE"],
    "Spanish is an official language in exactly these states",
  );
  assert.equal(SPANISH_SPEAKING_COUNTRIES.has("BR"), false, "Brazil is an owner decision: English, not Portuguese");
});

test("no recognized country outside the Spanish-speaking set resolves es", () => {
  for (const { iso, names } of RECOGNIZED_COUNTRIES) {
    if (SPANISH_SPEAKING_COUNTRIES.has(iso) || SANCTIONED_COUNTRIES.has(iso)) continue;
    for (const alias of names) assert.deepEqual(audience({ personCountry: alias }), MIAMI_EN, alias);
  }
});

test("drift pin: every recognized country name resolves to an audience unless it is sanctioned", () => {
  for (const { iso, names } of RECOGNIZED_COUNTRIES) {
    for (const alias of names) {
      const result = audience({ personCountry: alias });
      if (SANCTIONED_COUNTRIES.has(iso)) assert.equal(result, null, `${alias} is sanctioned`);
      else assert.notEqual(result, null, `${alias} is recognized but not mailable`);
    }
  }
});

test("every located country gets the Miami address: the owner's rule is not a list (Thailand, Vietnam, Nigeria)", () => {
  // Owner rule 2026-10-20: Argentina -> Mar del Plata, EVERY other located country -> Miami. A country we never listed
  // by hand must still be mailable, in English unless it is Spanish-speaking.
  for (const country of ["Thailand", "Vietnam", "Nigeria", "Tailandia", "Japón", "Australia", "Kosovo", "Bosnia and Herzegovina", "Côte d'Ivoire"]) {
    assert.deepEqual(audience({ personCountry: country }), MIAMI_EN, `${country} is located, so it must not hold`);
  }
  assert.deepEqual(audience({ companyCountry: "Alemania" }), MIAMI_EN);
  assert.deepEqual(audience({ companyCountry: "Países Bajos" }), MIAMI_EN);
  assert.deepEqual(audience({ companyCountry: "Reino Unido" }), MIAMI_EN);
});

test("recognition covers every ISO region, not a hand list", () => {
  const isos = new Set(RECOGNIZED_COUNTRIES.map((c) => c.iso));
  for (const iso of getCountries()) if (iso !== "AC" && iso !== "TA") assert.ok(isos.has(iso), `${iso} (dialable) must be recognized`);
  for (const iso of ["AQ", "BV", "HM", "TF", "UM", "XK", "PN", "EH"]) assert.ok(isos.has(iso), `${iso} (not dialable)`);
  assert.ok(isos.size >= 245, `only ${isos.size} regions`);
  for (const iso of ["EU", "UN", "ZZ", "XA", "DD", "SU", "AN", "CS"]) assert.equal(isos.has(iso), false, `${iso} is not a country`);
});

test("a name shared with a US state is harmless: the country and the state get the same audience", () => {
  const states = [
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii",
    "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
    "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico",
    "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
    "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming",
    "district of columbia",
  ];
  const us = audience({ personCountry: "United States" });
  assert.deepEqual(us, MIAMI_EN);
  let collisions = 0;
  for (const state of states) {
    if (!resolveCountry(state)) continue;
    collisions += 1;
    assert.deepEqual(audience({ personCountry: state }), us, `${state} is a country AND a US state, so both must mean the same footer and language`);
  }
  assert.ok(collisions >= 1, "Georgia (GE) is the known collision; the guard must see it");
  assert.equal(resolveCountry("Georgia"), "GE");
  assert.deepEqual(audience({ personCountry: "Georgia" }), MIAMI_EN);
  assert.deepEqual(audience({ personCountry: "Jersey" }), MIAMI_EN);
  // Not whole country names, so still no country at all.
  for (const text of ["New Mexico", "Washington", "New Jersey", "Miami, FL", "Greater Buenos Aires"]) assert.equal(resolveCountry(text), null, text);
});

test("no two countries share a name", () => {
  assert.deepEqual([...AMBIGUOUS_NAMES], []);
});

test("a country code is not a country name: ICU names that are just the code never match", () => {
  for (const code of ["de", "th", "ng", "ar", "es", "pe", "ca"]) assert.equal(resolveCountry(code), null, code);
  for (const { iso, names } of RECOGNIZED_COUNTRIES) {
    for (const name of names) if (name === iso.toLowerCase() && name !== "us") assert.fail(`${name} is the bare code of ${iso}`);
  }
});

test("names are unique to one country and resolve back to it", () => {
  const seen = new Map<string, string>();
  const isos = new Set(RECOGNIZED_COUNTRIES.map((c) => c.iso));
  for (const { iso, names } of RECOGNIZED_COUNTRIES) {
    for (const name of names) {
      assert.equal(seen.get(name), undefined, `${name} listed for ${seen.get(name)} and ${iso}`);
      seen.set(name, iso);
      assert.equal(resolveCountry(name), iso, name);
    }
  }
  for (const iso of [...SANCTIONED_COUNTRIES, ...SPANISH_SPEAKING_COUNTRIES]) assert.ok(isos.has(iso), iso);
});

test("every country libphonenumber can name resolves through the phone link; the policy sets hold for each", () => {
  let checked = 0;
  for (const iso of getCountries() as CountryCode[]) {
    const example = getExampleNumber(iso, examples);
    if (!example) continue;
    const result = audience({ mobilePhone: example.number });
    // +1 numbers, +7 and +44 shared plans can parse to a sibling region; judge by the country actually parsed.
    const name = example.country ? countryNameOf(example.country) : countryNameOf(iso);
    checked += 1;
    if (SANCTIONED_COUNTRIES.has(iso)) assert.equal(result, null, `${iso} (${name}) must hold by phone`);
    else if (iso === "AR") assert.deepEqual(result, MDP);
    else if (SPANISH_SPEAKING_COUNTRIES.has(iso)) assert.deepEqual(result, MIAMI_ES, `${iso} (${name})`);
    else assert.deepEqual(result, MIAMI_EN, `${iso} (${name}) is located, so it gets Miami in English`);
  }
  assert.ok(checked > 200, `only ${checked} countries checked`);
});

test("pure: the same input twice gives the same answer and the input is not mutated", () => {
  const input: ComplianceAudienceInputs = {
    mobilePhone: null,
    phone: ES_PHONE,
    personCountry: null,
    companyCountry: " Spain ",
    postingMarkets: ["latam", "us"],
  };
  const snapshot = structuredClone(input);
  const first = resolveComplianceAudience(input);
  const second = resolveComplianceAudience(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, snapshot);
  const out = resolveComplianceAudience({ mobilePhone: null, phone: null, personCountry: "Argentina" });
  assert.ok(out);
  (out as { address: string }).address = "tampered";
  assert.deepEqual(resolveComplianceAudience({ mobilePhone: null, phone: null, personCountry: "Argentina" }), MDP);
});

test("every country that has a footer today is still mailable: the new table covers the old market lists", () => {
  for (const name of [...LATAM_COUNTRY_NAMES, "united states", "canada"]) {
    assert.equal(recipientMarket({ mobilePhone: null, phone: null, personCountry: name }) !== "other", true, name);
    assert.notEqual(audience({ personCountry: name }), null, `${name} had a footer before and must not start holding`);
  }
});

test("sanctions, in literals (does not read SANCTIONED_COUNTRIES): Cuba, Iran, North Korea, Syria hold on every link", () => {
  const phones: Record<string, string> = { Cuba: "+5351234567", Iran: "+989121234567", "North Korea": "+85021234567", Syria: "+963944123456" };
  const isos: Record<string, string> = { Cuba: "CU", Iran: "IR", "North Korea": "KP", Syria: "SY" };
  for (const [country, phone] of Object.entries(phones)) {
    // Guard against a vacuous null: the number must really parse to the jurisdiction, not just be invalid.
    assert.equal(phoneCountryIso(phone, null), isos[country], `${phone} must parse as ${isos[country]}`);
    const why = `${country} is embargoed: the US-entity footer must not go on its mail`;
    assert.equal(audience({ personCountry: country }), null, `${why} (person)`);
    assert.equal(audience({ companyCountry: country }), null, `${why} (company)`);
    assert.equal(audience({ mobilePhone: phone }), null, `${why} (mobile ${phone})`);
    assert.equal(audience({ phone }), null, `${why} (phone ${phone})`);
    // A sanctioned country DECIDES; it never falls through to a cleaner later link.
    assert.equal(audience({ personCountry: country, companyCountry: "Spain", mobilePhone: AR_PHONE }), null, `${why} (decides over company + phone)`);
    assert.equal(audience({ companyCountry: country, mobilePhone: AR_PHONE }), null, `${why} (company decides over phone)`);
  }
  assert.equal(audience({ personCountry: "Cuba", companyCountry: "Germany", mobilePhone: AR_PHONE, postingMarkets: ["us"] }), null);
});

test("fail closed with no ICU names: phones still resolve by ISO and sanctioned phones hold; free text holds", () => {
  const script = new URL("./fixtures/complianceAudienceStrippedIcu.ts", import.meta.url).pathname;
  const out = JSON.parse(execFileSync("npx", ["tsx", script], { encoding: "utf8" }).trim().split("\n").pop() as string);
  assert.deepEqual(out.argentinaPhone, MDP, "an Argentine phone must not depend on ICU");
  assert.deepEqual(out.mexicoPhone, MIAMI_ES, "a Mexican phone keeps Spanish without ICU");
  assert.equal(out.cubaPhone, null, "a Cuban phone must hold without ICU, never default to Miami");
  assert.equal(out.iranPhone, null, "an Iranian phone must hold without ICU, never default to Miami");
  // The table collapses to the aliases only; it must not silently become a mailable one.
  assert.ok(out.names < 60, `stripped table should hold only aliases, got ${out.names} names`);
  assert.equal(out.germany, null, "free text with no ICU names holds");
  assert.equal(out.argentinaText, null);
  assert.equal(out.thailand, null);
  assert.equal(out.cubaText, null);
});

test("a phone whose country cannot be established holds; it never defaults to Miami", () => {
  assert.equal(audience({ mobilePhone: "+999123456" }), null);
  assert.equal(audience({ mobilePhone: "5491155551234" }), null, "no leading + means no jurisdiction");
});

test("pinned limit: a city whose name is also a country resolves to the country (no city exclusion list)", () => {
  // ICU's Spanish name for Grenada (GD) is "Granada" and for Saint Lucia (LC) "Santa Lucía". A Spanish or Nicaraguan contact
  // who typed the CITY gets English: correct address, wrong language, on bad input. Recorded, not fixed by a hand-kept list.
  assert.equal(resolveCountry("Granada"), "GD");
  assert.deepEqual(audience({ personCountry: "Granada" }), MIAMI_EN);
  assert.equal(resolveCountry("Santa Lucía"), "LC");
  assert.deepEqual(audience({ personCountry: "Santa Lucía" }), MIAMI_EN);
});
