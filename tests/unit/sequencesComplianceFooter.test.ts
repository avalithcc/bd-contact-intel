import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPLIANCE_CONFIG, type ComplianceConfig } from "../../src/lib/sequences/config";
import { appendFooter, bodyHasFooter, buildFooter } from "../../src/lib/sequences/complianceFooter";
import { classifyMarket, isKnownCountryName } from "../../src/lib/hiring/markets";
import { recipientMarket } from "../../src/lib/sequences/recipientMarket";

const NO_PHONE = { mobilePhone: null, phone: null } as const;
const URL = "https://example.test/unsubscribe/abc123";
const US = "Avalith Corporation, 470 Ansin Blvd Ste G, Hallandale, FL 33009, USA";
const LATAM = "Avalith, Formosa 2531, B7600 Mar del Plata, Buenos Aires, Argentina";

test("config holds the confirmed address for us and latam, and no entry for other", () => {
  assert.equal(COMPLIANCE_CONFIG.us?.postalAddress, US);
  assert.equal(COMPLIANCE_CONFIG.latam?.postalAddress, LATAM);
  assert.equal(Object.hasOwn(COMPLIANCE_CONFIG, "other"), false);
});

test("a us recipient gets the Hallandale address, a latam recipient the Mar del Plata one", () => {
  const us = buildFooter(COMPLIANCE_CONFIG, "us", URL);
  const latam = buildFooter(COMPLIANCE_CONFIG, "latam", URL);
  assert.equal(us.status, "ok");
  assert.equal(latam.status, "ok");
  if (us.status === "ok") assert.ok(us.text.includes(US) && !us.text.includes("Mar del Plata"));
  if (latam.status === "ok") assert.ok(latam.text.includes(LATAM) && !latam.text.includes("Hallandale"));
});

test("the footer carries the opt-out text, the per-recipient link, and the reply path", () => {
  const footer = buildFooter(COMPLIANCE_CONFIG, "us", URL);
  assert.equal(footer.status, "ok");
  if (footer.status !== "ok") return;
  assert.ok(footer.text.includes(COMPLIANCE_CONFIG.us!.optOutText));
  assert.ok(footer.text.includes(URL));
  assert.match(footer.text, /reply/i);
});

test("other is explicitly unmapped: no default address, ever", () => {
  assert.deepEqual(buildFooter(COMPLIANCE_CONFIG, "other", URL), { status: "unmapped", market: "other" });
  assert.deepEqual(appendFooter("Hi", COMPLIANCE_CONFIG, "other", URL), { status: "unmapped", market: "other" });
  assert.equal(bodyHasFooter(`Hi\n${US}\n${COMPLIANCE_CONFIG.us!.optOutText}`, COMPLIANCE_CONFIG, "other"), false);
});

test("model output with no address or opt-out still ends up with the footer", () => {
  const generated = "Hi Jane,\n\nWe help teams hire.\n\nCristian";
  assert.equal(bodyHasFooter(generated, COMPLIANCE_CONFIG, "us"), false);
  const result = appendFooter(generated, COMPLIANCE_CONFIG, "us", URL);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.ok(result.body.startsWith(generated));
  assert.equal(bodyHasFooter(result.body, COMPLIANCE_CONFIG, "us"), true);
});

test("the reminder body gets the same footer as step 1", () => {
  const step1 = appendFooter("First email", COMPLIANCE_CONFIG, "latam", URL);
  const reminder = appendFooter("Just following up", COMPLIANCE_CONFIG, "latam", URL);
  assert.equal(step1.status, "ok");
  assert.equal(reminder.status, "ok");
  if (step1.status !== "ok" || reminder.status !== "ok") return;
  assert.equal(step1.body.slice("First email".length), reminder.body.slice("Just following up".length));
});

test("a body where the BD deleted the address fails the check", () => {
  const result = appendFooter("Hi", COMPLIANCE_CONFIG, "us", URL);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(bodyHasFooter(result.body.replace(US, ""), COMPLIANCE_CONFIG, "us"), false);
  assert.equal(bodyHasFooter(result.body.replace(COMPLIANCE_CONFIG.us!.optOutText, ""), COMPLIANCE_CONFIG, "us"), false);
});

test("the wrong market's address does not satisfy the check", () => {
  const latamBody = appendFooter("Hi", COMPLIANCE_CONFIG, "latam", URL);
  assert.equal(latamBody.status, "ok");
  if (latamBody.status !== "ok") return;
  assert.equal(bodyHasFooter(latamBody.body, COMPLIANCE_CONFIG, "us"), false);
});

test("changing a configured address changes the footer with no other edit", () => {
  const changed: ComplianceConfig = {
    ...COMPLIANCE_CONFIG,
    us: { ...COMPLIANCE_CONFIG.us!, postalAddress: "Avalith Corporation, 1 New St, Miami, FL 33101, USA" },
  };
  const footer = buildFooter(changed, "us", URL);
  assert.equal(footer.status, "ok");
  if (footer.status !== "ok") return;
  assert.ok(footer.text.includes("1 New St"));
  assert.ok(!footer.text.includes("Ansin"));
});

test("link 1: person.country wins and is classified through classifyMarket", () => {
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "United States" }), "us");
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "USA" }), "us");
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "Argentina" }), "latam");
});

test("link 2: company.country is used when person.country is empty", () => {
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: null, companyCountry: "United States" }), "us");
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "  ", companyCountry: "Argentina" }), "latam");
});

test("precedence: a person.country that disagrees with company.country wins", () => {
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "Argentina", companyCountry: "United States" }), "latam");
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "United States", companyCountry: "Argentina" }), "us");
});

test("link 3: the company's open IT posting markets are used when both countries are empty", () => {
  assert.equal(recipientMarket({ ...NO_PHONE, postingMarkets: ["us"] }), "us");
  assert.equal(recipientMarket({ ...NO_PHONE, postingMarkets: ["latam", "latam"] }), "latam");
  assert.equal(recipientMarket({ ...NO_PHONE, companyCountry: "", postingMarkets: ["us", null, "other"] }), "us");
});

test("link 3 is not consulted when a country is present, even if postings disagree", () => {
  assert.equal(recipientMarket({ ...NO_PHONE, companyCountry: "Argentina", postingMarkets: ["us"] }), "latam");
});

test("link 3 refuses to guess when postings are all other, empty, null or conflicting", () => {
  assert.equal(recipientMarket({ ...NO_PHONE, postingMarkets: ["other", "other"] }), "other");
  assert.equal(recipientMarket({ ...NO_PHONE, postingMarkets: [null] }), "other");
  assert.equal(recipientMarket({ ...NO_PHONE, postingMarkets: [] }), "other");
  assert.equal(recipientMarket({ ...NO_PHONE, postingMarkets: ["us", "latam"] }), "other");
  assert.equal(recipientMarket({ ...NO_PHONE, postingMarkets: ["bogus"] }), "other");
});

test("a country that is present but unmapped (Spain) stays other and does not fall through", () => {
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "Spain", companyCountry: "United States", postingMarkets: ["us"] }), "other");
  assert.equal(recipientMarket({ ...NO_PHONE, companyCountry: "Spain", postingMarkets: ["us"] }), "other");
});

test("Canada resolves to the us posture (address and English draft) from the person or the company country", () => {
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "Canada" }), "us");
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "  canada ", companyCountry: "Argentina" }), "us");
  assert.equal(recipientMarket({ ...NO_PHONE, companyCountry: "Canada" }), "us");
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "Canada", companyCountry: "Spain", postingMarkets: ["latam"] }), "us");
});

test("the Canada rule is exact: look-alikes and other unmapped countries still refuse", () => {
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "Canada Bay, Australia" }), "other");
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "Spain" }), "other");
  assert.equal(recipientMarket({ ...NO_PHONE, postingMarkets: ["other"] }), "other");
});

test("the Canada rule lives in the sequences layer: classifyMarket still calls Canada other", async () => {
  const { classifyMarket } = await import("../../src/lib/hiring/markets");
  assert.equal(classifyMarket("Canada"), "other");
});

test("all three links absent resolves to other (hold, never send)", () => {
  assert.equal(recipientMarket({ ...NO_PHONE }), "other");
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: null, companyCountry: null, postingMarkets: null }), "other");
});

test("Spanish-speaking Central America resolves latam and Puerto Rico resolves us", () => {
  for (const country of ["El Salvador", "Honduras", "Nicaragua", "el salvador"]) {
    assert.equal(recipientMarket({ ...NO_PHONE, personCountry: country }), "latam", country);
    assert.equal(classifyMarket(country), "latam", country);
  }
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "Puerto Rico" }), "us");
  assert.equal(classifyMarket("San Juan, Puerto Rico"), "us");
});

test("Cuba stays unmapped on purpose: a US-entity footer to Cuba is an OFAC question for the owner", () => {
  assert.equal(recipientMarket({ ...NO_PHONE, personCountry: "Cuba" }), "other");
  assert.equal(isKnownCountryName("Cuba"), false);
});

test("the new country names do not reclassify the Brazilian city of Salvador", () => {
  assert.equal(classifyMarket("Salvador, Bahia, Brazil"), "latam");
  assert.equal(classifyMarket("Salvador, Bahia"), "other");
});
