import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPLIANCE_CONFIG, type ComplianceConfig } from "../../src/lib/sequences/config";
import { appendFooter, bodyHasFooter, buildFooter } from "../../src/lib/sequences/complianceFooter";
import { recipientMarket } from "../../src/lib/sequences/recipientMarket";

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

test("recipientMarket resolves from the Contact country through classifyMarket", () => {
  assert.equal(recipientMarket({ country: "United States" }), "us");
  assert.equal(recipientMarket({ country: "USA" }), "us");
  assert.equal(recipientMarket({ country: "Argentina" }), "latam");
});

test("recipientMarket fails safe to other when the country is unknown or unresolvable", () => {
  assert.equal(recipientMarket({ country: null }), "other");
  assert.equal(recipientMarket({ country: "" }), "other");
  assert.equal(recipientMarket({ country: "   " }), "other");
  assert.equal(recipientMarket({ country: "Spain" }), "other");
  assert.equal(recipientMarket({}), "other");
});

test("recipientMarket never guesses from city alone", () => {
  assert.equal(recipientMarket({ country: null, city: "Miami" } as { country: null }), "other");
});
