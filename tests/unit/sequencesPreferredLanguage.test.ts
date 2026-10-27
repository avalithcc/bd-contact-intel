/**
 * preferred-language: precedence of the draft language (one-off choice > preferred language > audience chain), and that the
 * preferred language changes the LANGUAGE only: never the legal address, never a HOLD. Every producer of the draft language
 * (the draft input, the unsubscribe page) is asserted against the same table, built from the real resolver.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RECOGNIZED_COUNTRIES, resolveComplianceAudience, type AudienceLanguage, type ComplianceAudience } from "@/lib/sequences/complianceAudience";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { buildSequenceDraftInput, resolveDraftCompliance, type SequenceDraftInputArgs } from "@/lib/sequences/draftInput";
import { LANGUAGE_CHOICES, preferredCheckbox, resolveDraftLanguage } from "@/lib/sequences/languageChoice";
import { unsubscribePageAudience } from "@/lib/sequences/unsubscribePageAudience";

const base: SequenceDraftInputArgs = {
  person: { firstName: "Ana", lastName: "Lee", jobTitle: "VP Engineering", roleGroup: null, industry: null, companyKey: "acme" },
  connection: null,
  signalBodies: [],
  company: null,
  senderName: "Cristian Civita",
  senderTitle: undefined,
};

const AUDIENCES: ComplianceAudience[] = [
  ...new Map(
    RECOGNIZED_COUNTRIES.flatMap((c) => {
      const a = resolveComplianceAudience({ mobilePhone: null, phone: null, rosterCountries: [], personCountry: c.names[0] ?? c.iso, companyCountry: null, postingMarkets: [] });
      return a ? [[`${a.address}/${a.language}`, a] as const] : [];
    }),
  ).values(),
];
const other = (l: AudienceLanguage): AudienceLanguage => LANGUAGE_CHOICES.find((c) => c !== l)!;
const NONE = { chosen: null, preferred: null };

test("the table covers both audience languages (not vacuous)", () => {
  assert.ok(AUDIENCES.some((a) => a.language === "es") && AUDIENCES.some((a) => a.language === "en"));
});

test("precedence: a one-off choice beats the preferred language, which beats the audience", () => {
  for (const audience of LANGUAGE_CHOICES) {
    const o = other(audience);
    assert.deepEqual(resolveDraftLanguage(audience, NONE), { language: audience, source: "audience", baseline: audience, baselineSource: "audience" });
    assert.deepEqual(resolveDraftLanguage(audience, { chosen: null, preferred: o }), { language: o, source: "preferred", baseline: o, baselineSource: "preferred" });
    assert.deepEqual(resolveDraftLanguage(audience, { chosen: o, preferred: null }), { language: o, source: "chosen", baseline: audience, baselineSource: "audience" });
    // Both set and different: the one-off wins, and the baseline it is measured against is the PREFERENCE, not the audience.
    assert.deepEqual(resolveDraftLanguage(audience, { chosen: audience, preferred: o }), { language: audience, source: "chosen", baseline: o, baselineSource: "preferred" });
  }
});

test("a stored value that is not es or en reads as nothing, for either override", () => {
  for (const garbage of ["pt", "ES", "", null, undefined, 1]) {
    assert.equal(resolveDraftLanguage("en", { chosen: garbage, preferred: garbage })?.source, "audience", String(garbage));
  }
});

test("with no audience there is nothing to resolve unless an override exists", () => {
  assert.equal(resolveDraftLanguage(null, NONE), null);
  assert.deepEqual(resolveDraftLanguage(null, { chosen: null, preferred: "es" }), { language: "es", source: "preferred", baseline: "es", baselineSource: "preferred" });
});

test("resolveDraftLanguage does not mutate what it is given and answers the same twice", () => {
  const overrides = Object.freeze({ chosen: "es", preferred: "en" });
  const first = resolveDraftLanguage("en", overrides);
  assert.deepEqual(resolveDraftLanguage("en", overrides), first);
  assert.deepEqual(overrides, { chosen: "es", preferred: "en" });
});

test("PRODUCER draft input: the generator is told the preferred language, in both directions, for every audience", () => {
  for (const a of AUDIENCES) {
    const o = other(a.language);
    assert.equal(buildSequenceDraftInput(base, a, "first", { chosen: null, preferred: o })?.language, o);
    assert.equal(buildSequenceDraftInput(base, a, "reminder", { chosen: null, preferred: o })?.language, o);
    assert.equal(buildSequenceDraftInput(base, a, "first", NONE)?.language, a.language);
  }
});

test("PRODUCER draft input: a one-off choice beats the preference for that draft only", () => {
  for (const a of AUDIENCES) {
    const o = other(a.language);
    assert.equal(buildSequenceDraftInput(base, a, "first", { chosen: a.language, preferred: o })?.language, a.language);
    assert.equal(buildSequenceDraftInput(base, a, "first", { chosen: null, preferred: o })?.language, o);
  }
});

test("SAFETY: the preferred language never moves the legal address", () => {
  for (const a of AUDIENCES) {
    for (const preferred of LANGUAGE_CHOICES) {
      const c = resolveDraftCompliance(a, { chosen: null, preferred })!;
      assert.equal(c.address, a.address);
      assert.ok(COMPLIANCE_CONFIG[c.address]);
    }
  }
});

test("SAFETY: a preferred language never unblocks a HOLD", () => {
  for (const preferred of LANGUAGE_CHOICES) {
    assert.equal(resolveDraftCompliance(null, { chosen: null, preferred }), null);
    assert.equal(buildSequenceDraftInput(base, null, "first", { chosen: null, preferred }), null);
  }
});

test("PRODUCER unsubscribe page: the locale follows the same resolution as the draft, and the address stays the audience's", () => {
  const usCompany = { mobilePhone: null, phone: null, rosterCountries: [], personCountry: null, companyCountry: "United States", postingMarkets: [] };
  const plain = unsubscribePageAudience(usCompany);
  assert.equal(plain?.locale, "en");
  const preferred = unsubscribePageAudience(usCompany, { chosen: null, preferred: "es" });
  assert.equal(preferred?.locale, "es");
  assert.equal(preferred?.postalAddress, plain?.postalAddress);
  assert.equal(unsubscribePageAudience(usCompany, { chosen: "en", preferred: "es" })?.locale, "en", "a one-off choice still beats the preference");
});

test("save-as-preferred checkbox: shown only when there is something to save", () => {
  for (const baseline of LANGUAGE_CHOICES) {
    assert.equal(preferredCheckbox(null, baseline, baseline), null, "no preference, selection equals what the system resolved");
    assert.equal(preferredCheckbox(baseline, baseline, baseline), null, "selection equals the stored preference");
  }
});

test("save-as-preferred checkbox: checked by default when nothing is stored, unchecked when saving would replace a stored value", () => {
  for (const audience of LANGUAGE_CHOICES) {
    const o = other(audience);
    assert.deepEqual(preferredCheckbox(null, audience, o), { checked: true, replaces: false });
    // The baseline of a contact with a stored preference IS that preference (resolveDraftLanguage), so the selection differs from it.
    assert.deepEqual(preferredCheckbox(o, o, audience), { checked: false, replaces: true });
  }
});
