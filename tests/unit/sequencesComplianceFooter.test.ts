import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPLIANCE_CONFIG, type ComplianceConfig } from "../../src/lib/sequences/config";
import { appendFooter, bodyHasFooter, buildFooter } from "../../src/lib/sequences/complianceFooter";

const URL = "https://example.test/unsubscribe/abc123";
const US = "Avalith Corporation, 470 Ansin Blvd Ste G, Hallandale, FL 33009, USA";
const LATAM = "Avalith, Formosa 2531, B7600 Mar del Plata, Buenos Aires, Argentina";

test("config holds the confirmed address for miami and mdp, and nothing else", () => {
  assert.equal(COMPLIANCE_CONFIG.miami?.postalAddress, US);
  assert.equal(COMPLIANCE_CONFIG.mdp?.postalAddress, LATAM);
  assert.deepEqual(Object.keys(COMPLIANCE_CONFIG).sort(), ["mdp", "miami"]);
});

test("the miami address is the Hallandale one, the mdp address the Mar del Plata one", () => {
  const us = buildFooter(COMPLIANCE_CONFIG, "miami", URL);
  const latam = buildFooter(COMPLIANCE_CONFIG, "mdp", URL);
  assert.equal(us.status, "ok");
  assert.equal(latam.status, "ok");
  if (us.status === "ok") assert.ok(us.text.includes(US) && !us.text.includes("Mar del Plata"));
  if (latam.status === "ok") assert.ok(latam.text.includes(LATAM) && !latam.text.includes("Hallandale"));
});

test("the footer carries the opt-out text, the per-recipient link, and the reply path", () => {
  const footer = buildFooter(COMPLIANCE_CONFIG, "miami", URL);
  assert.equal(footer.status, "ok");
  if (footer.status !== "ok") return;
  assert.ok(footer.text.includes(COMPLIANCE_CONFIG.miami!.optOutText));
  assert.ok(footer.text.includes(URL));
  assert.match(footer.text, /reply/i);
});

test("an address with no entry is explicitly unmapped: no default address, ever", () => {
  const none = "other" as never;
  assert.deepEqual(buildFooter(COMPLIANCE_CONFIG, none, URL), { status: "unmapped", address: none });
  assert.deepEqual(appendFooter("Hi", COMPLIANCE_CONFIG, none, URL), { status: "unmapped", address: none });
  assert.equal(bodyHasFooter(`Hi\n${US}\n${COMPLIANCE_CONFIG.miami!.optOutText}`, COMPLIANCE_CONFIG, none), false);
});

test("model output with no address or opt-out still ends up with the footer", () => {
  const generated = "Hi Jane,\n\nWe help teams hire.\n\nCristian";
  assert.equal(bodyHasFooter(generated, COMPLIANCE_CONFIG, "miami"), false);
  const result = appendFooter(generated, COMPLIANCE_CONFIG, "miami", URL);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.ok(result.body.startsWith(generated));
  assert.equal(bodyHasFooter(result.body, COMPLIANCE_CONFIG, "miami"), true);
});

test("the reminder body gets the same footer as step 1", () => {
  const step1 = appendFooter("First email", COMPLIANCE_CONFIG, "mdp", URL);
  const reminder = appendFooter("Just following up", COMPLIANCE_CONFIG, "mdp", URL);
  assert.equal(step1.status, "ok");
  assert.equal(reminder.status, "ok");
  if (step1.status !== "ok" || reminder.status !== "ok") return;
  assert.equal(step1.body.slice("First email".length), reminder.body.slice("Just following up".length));
});

test("a body where the BD deleted the address fails the check", () => {
  const result = appendFooter("Hi", COMPLIANCE_CONFIG, "miami", URL);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(bodyHasFooter(result.body.replace(US, ""), COMPLIANCE_CONFIG, "miami"), false);
  assert.equal(bodyHasFooter(result.body.replace(COMPLIANCE_CONFIG.miami!.optOutText, ""), COMPLIANCE_CONFIG, "miami"), false);
});

test("the wrong address does not satisfy the check", () => {
  const latamBody = appendFooter("Hi", COMPLIANCE_CONFIG, "mdp", URL);
  assert.equal(latamBody.status, "ok");
  if (latamBody.status !== "ok") return;
  assert.equal(bodyHasFooter(latamBody.body, COMPLIANCE_CONFIG, "miami"), false);
});

test("changing a configured address changes the footer with no other edit", () => {
  const changed: ComplianceConfig = {
    ...COMPLIANCE_CONFIG,
    miami: { ...COMPLIANCE_CONFIG.miami!, postalAddress: "Avalith Corporation, 1 New St, Miami, FL 33101, USA" },
  };
  const footer = buildFooter(changed, "miami", URL);
  assert.equal(footer.status, "ok");
  if (footer.status !== "ok") return;
  assert.ok(footer.text.includes("1 New St"));
  assert.ok(!footer.text.includes("Ansin"));
});

import { splitFooter } from "../../src/lib/sequences/complianceFooter";

test("splitFooter cuts a body built by appendFooter at its footer, for both addresses", () => {
  for (const address of ["mdp", "miami"] as const) {
    const built = appendFooter("Hello Jane,\n\nShort note.", COMPLIANCE_CONFIG, address, URL);
    assert.equal(built.status, "ok");
    if (built.status !== "ok") return;
    const parts = splitFooter(built.body, COMPLIANCE_CONFIG);
    assert.ok(parts, address);
    assert.equal(parts.message, "Hello Jane,\n\nShort note.\n\n");
    const footer = buildFooter(COMPLIANCE_CONFIG, address, URL);
    assert.equal(footer.status === "ok" && parts.footer, footer.status === "ok" && footer.text);
    assert.equal(parts.message + parts.footer, built.body, "the two halves reassemble the body exactly");
  }
});

test("splitFooter keys on the dashes AND the configured address: a bare `--` in the message never splits", () => {
  const built = appendFooter("Line one\n--\nLine two, after a rule", COMPLIANCE_CONFIG, "mdp", URL);
  assert.equal(built.status, "ok");
  if (built.status !== "ok") return;
  const parts = splitFooter(built.body, COMPLIANCE_CONFIG);
  assert.ok(parts);
  assert.equal(parts.message, "Line one\n--\nLine two, after a rule\n\n");
  assert.equal(splitFooter("Hi\n--\nJane\nSome Street 1", COMPLIANCE_CONFIG), null);
});

test("splitFooter returns null when the footer was edited away", () => {
  assert.equal(splitFooter("Hello, no footer here", COMPLIANCE_CONFIG), null);
  assert.equal(splitFooter(`Hello\n${LATAM}\n`, COMPLIANCE_CONFIG), null, "the address without the dashes line is not a footer");
});
