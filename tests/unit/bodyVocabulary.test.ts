/**
 * The body half of the vendor-vocabulary rule. Measured 2026-11-17: 28 of 37 persisted bodies said "staff augmentation"
 * while only the subject was checked, so the rule was a request to the model and nothing more.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { bannedTermsInBody, SUBJECT_BANNED_PHRASES } from "@/lib/outreach/subjectRules";
import { bannedVocabularyReason, checkBodyVocabulary, parseBannedVocabularyReason } from "@/lib/sequences/approvalChecks";
import { appendFooter } from "@/lib/sequences/complianceFooter";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";

const URL = `https://crm.example.test/api/unsubscribe?t=${"a".repeat(43)}`;
const footed = (message: string) => {
  const r = appendFooter(message, COMPLIANCE_CONFIG, "miami", "en", URL);
  assert.equal(r.status, "ok");
  return r.status === "ok" ? r.body : "";
};

describe("bannedTermsInBody", () => {
  it("finds the term that was measured in 28 live bodies, accents and case aside", () => {
    assert.deepEqual(bannedTermsInBody("Ofrecemos Staff Augmentation senior."), ["staff augmentation"]);
    assert.deepEqual(bannedTermsInBody("Tenemos una propuesta y un servicio de soluciones"), ["soluciones", "propuesta"]);
  });
  it("matches whole words only, so engineering vocabulary is not refused", () => {
    assert.deepEqual(bannedTermsInBody("We run microservices and a Data Solutionsmith team."), []);
    assert.deepEqual(bannedTermsInBody("Backend en Card y Fraud, sin pisar a RRHH"), []);
  });
});

describe("checkBodyVocabulary", () => {
  it("refuses a body with the term and names it in the reason", () => {
    const r = checkBodyVocabulary(footed("We do staff augmentation for you."), COMPLIANCE_CONFIG);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(parseBannedVocabularyReason(r.reason), "staff augmentation");
  });
  it("does not read the compliance footer", () => {
    const footer = footed("Clean text").split("\n--\n")[1]!;
    const words = footer.toLowerCase();
    for (const term of SUBJECT_BANNED_PHRASES) assert.ok(!words.includes(term), `the real footer carries "${term}"`);
    // A footer that DID carry a term must still not refuse: simulate by checking the split, with a config whose address holds a term.
    const cfg = { ...COMPLIANCE_CONFIG, miami: { ...COMPLIANCE_CONFIG.miami!, postalAddress: `${COMPLIANCE_CONFIG.miami!.postalAddress} services` } };
    const r = appendFooter("Clean text", cfg, "miami", "en", URL);
    assert.equal(r.status, "ok");
    assert.deepEqual(checkBodyVocabulary(r.status === "ok" ? r.body : "", cfg), { ok: true });
  });
  it("passes a clean body and is stable on repeat calls", () => {
    const body = footed("Vi que tienen búsquedas abiertas de backend.");
    assert.deepEqual(checkBodyVocabulary(body, COMPLIANCE_CONFIG), { ok: true });
    assert.deepEqual(checkBodyVocabulary(body, COMPLIANCE_CONFIG), { ok: true });
  });
  it("checks the whole text when the footer was edited away", () => {
    const r = checkBodyVocabulary("nearshore squads, no footer", COMPLIANCE_CONFIG);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(parseBannedVocabularyReason(r.reason), "squads, nearshore");
  });
  it("round-trips the reason", () => {
    assert.equal(parseBannedVocabularyReason(bannedVocabularyReason(["a", "b"])), "a, b");
    assert.equal(parseBannedVocabularyReason("missing_footer"), null);
  });
});
