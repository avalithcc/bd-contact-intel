/**
 * draft-language-choice: a person may choose the draft's language, and that choice changes the language and NOTHING ELSE.
 * The postal address is CAN-SPAM compliance (the entity nearest the recipient's real location) and is never editorial.
 * Expectations are derived from the audience table and the config, never from hardcoded address or sentence strings.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RECOGNIZED_COUNTRIES, resolveComplianceAudience, type AudienceLanguage, type ComplianceAudience } from "@/lib/sequences/complianceAudience";
import { bodyHasFooter } from "@/lib/sequences/complianceFooter";
import { COMPLIANCE_CONFIG, OPT_OUT_TEXT } from "@/lib/sequences/config";
import { composeDraft } from "@/lib/sequences/draftCompose";
import { buildSequenceDraftInput, resolveDraftCompliance, type SequenceDraftInputArgs } from "@/lib/sequences/draftInput";
import { choiceToStore, LANGUAGE_CHOICES, parseLanguageChoice } from "@/lib/sequences/languageChoice";

const base: SequenceDraftInputArgs = {
  person: { firstName: "Ana", lastName: "Lee", jobTitle: "VP Engineering", roleGroup: null, industry: null, companyKey: "acme" },
  connection: null,
  signalBodies: [],
  company: null,
  senderName: "Cristian Civita",
  senderTitle: undefined,
};

/** Every distinct audience the resolver can produce, derived from the country table (not listed by hand). */
const AUDIENCES: ComplianceAudience[] = [
  ...new Map(
    RECOGNIZED_COUNTRIES.flatMap((c) => {
      const a = resolveComplianceAudience({ mobilePhone: null, phone: null, personCountry: c.names[0] ?? c.iso });
      return a ? [[`${a.address}/${a.language}`, a] as const] : [];
    }),
  ).values(),
];
const other = (l: AudienceLanguage): AudienceLanguage => LANGUAGE_CHOICES.find((c) => c !== l)!;
const GENERATED = { subject: "Hello", body: "A short message." };
const URL = "https://example.test/u/token";

test("the table covers an override in both directions (not vacuous)", () => {
  assert.ok(AUDIENCES.some((a) => a.language === "es"));
  assert.ok(AUDIENCES.some((a) => a.language === "en"));
});

test("a stored choice wins over the audience's language", () => {
  for (const a of AUDIENCES) {
    const chosen = other(a.language);
    assert.equal(buildSequenceDraftInput(base, a, "first", chosen)?.language, chosen);
    assert.equal(buildSequenceDraftInput(base, a, "first")?.language, a.language);
    assert.equal(buildSequenceDraftInput(base, a, "first", undefined)?.language, a.language);
  }
});

test("SAFETY: the postal address is identical with and without an override, in both directions", () => {
  for (const a of AUDIENCES) {
    for (const chosen of LANGUAGE_CHOICES) {
      assert.equal(resolveDraftCompliance(a, chosen)?.address, a.address);
      const c = resolveDraftCompliance(a, chosen)!;
      const withChoice = composeDraft(GENERATED, c.address, c.language, URL)!;
      const without = composeDraft(GENERATED, a.address, a.language, URL)!;
      const own = COMPLIANCE_CONFIG[a.address]!.postalAddress;
      assert.ok(withChoice.body.includes(own), `${a.address}/${chosen}: footer lost the audience's address`);
      for (const [key, entry] of Object.entries(COMPLIANCE_CONFIG)) {
        if (key !== a.address) assert.ok(!withChoice.body.includes(entry!.postalAddress), `${a.address}/${chosen}: carries the ${key} address`);
      }
      assert.equal(withChoice.body.split("\n").find((l) => l === own), without.body.split("\n").find((l) => l === own));
    }
  }
});

test("the opt-out sentence follows the CHOSEN language while the address follows the audience", () => {
  for (const a of AUDIENCES) {
    const chosen = other(a.language);
    const c = resolveDraftCompliance(a, chosen)!;
    const body = composeDraft(GENERATED, c.address, c.language, URL)!.body;
    assert.ok(body.includes(OPT_OUT_TEXT[chosen]));
    assert.ok(!body.includes(OPT_OUT_TEXT[a.language]));
    assert.ok(body.includes(COMPLIANCE_CONFIG[a.address]!.postalAddress));
    assert.ok(bodyHasFooter(body, COMPLIANCE_CONFIG, a.address), "the send gate must still accept the footer");
  }
});

test("regeneration reuses the stored choice; clearing it returns to the resolved language", () => {
  for (const a of AUDIENCES) {
    const chosen = other(a.language);
    const stored = parseLanguageChoice(chosen);
    const first = resolveDraftCompliance(a, stored)!.language;
    const regenerated = resolveDraftCompliance(a, stored)!.language;
    assert.equal(regenerated, first);
    assert.equal(regenerated, chosen);
    assert.deepEqual(choiceToStore(a.language, stored, a.language), { action: "clear" });
    assert.equal(resolveDraftCompliance(a, null)!.language, a.language);
  }
});

test("what to store: only a real difference is recorded, and confirming the resolved language records nothing", () => {
  for (const resolved of LANGUAGE_CHOICES) {
    const o = other(resolved);
    assert.deepEqual(choiceToStore(resolved, null, resolved), { action: "none" });
    assert.deepEqual(choiceToStore(resolved, null, o), { action: "set", language: o });
    assert.deepEqual(choiceToStore(resolved, o, o), { action: "none" });
    assert.deepEqual(choiceToStore(resolved, o, resolved), { action: "clear" });
  }
});

test("only es and en are accepted as a choice; everything else is rejected", () => {
  for (const ok of LANGUAGE_CHOICES) assert.equal(parseLanguageChoice(ok), ok);
  for (const bad of ["pt", "ES", "En", "", " es", "es ", "spanish", null, undefined, 1, true, {}, ["es"]]) {
    assert.equal(parseLanguageChoice(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("a HOLD cannot be drafted whatever the stored choice is", () => {
  for (const chosen of [...LANGUAGE_CHOICES, undefined, null]) {
    assert.equal(buildSequenceDraftInput(base, null, "first", chosen ?? undefined), null);
    assert.equal(resolveDraftCompliance(null, chosen ?? null), null);
  }
});

test("a stored value that is not es or en can never reach the generator: it reads as no choice", () => {
  for (const a of AUDIENCES) assert.equal(resolveDraftCompliance(a, parseLanguageChoice("pt"))!.language, a.language);
});
