/**
 * preferred-language: precedence of the draft language (one-off choice > preferred language > audience chain), and that the
 * preferred language changes the LANGUAGE only: never the legal address, never a HOLD. Every producer of the draft language
 * (the draft input, the unsubscribe page) is asserted against the same table, built from the real resolver.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RECOGNIZED_COUNTRIES, resolveComplianceAudience, type AudienceLanguage, type ComplianceAudience } from "@/lib/sequences/complianceAudience";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { preferredStamp } from "@/lib/sequences/audienceCard";
import { buildSequenceDraftInput, resolveDraftCompliance, type SequenceDraftInputArgs } from "@/lib/sequences/draftInput";
import { LANGUAGE_CHOICES, preferredCheckbox, resolveDraftLanguage } from "@/lib/sequences/languageChoice";
import { unsubscribePageAudience } from "@/lib/sequences/unsubscribePageAudience";

const base: SequenceDraftInputArgs = {
  person: { firstName: "Ana", lastName: "Lee", jobTitle: "VP Engineering", roleGroup: null, industry: null, companyKey: "acme", company: "Acme Inc" },
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

test("save-as-preferred checkbox: hidden only when the selection equals the STORED preference", () => {
  for (const l of LANGUAGE_CHOICES) {
    assert.equal(preferredCheckbox(l, l, l), null);
    assert.equal(preferredCheckbox(l, l, other(l)), null, "even if the dialog opened on the other language");
  }
});

test("save-as-preferred checkbox: with nothing stored it is checked only when the BD changed the radio in this session", () => {
  for (const opened of LANGUAGE_CHOICES) {
    assert.deepEqual(preferredCheckbox(null, other(opened), opened), { checked: true, replaces: false });
    // Same language as the dialog opened with: shown but unchecked, so a BD can pin the automatic language on purpose.
    assert.deepEqual(preferredCheckbox(null, opened, opened), { checked: false, replaces: false });
  }
});

test("save-as-preferred checkbox: reopening on an existing one-off does not pre-check the box, so a plain confirm promotes nothing", () => {
  // The member already holds a one-off "es" over an automatic "en"; the dialog opens on "es" and the BD changes nothing.
  const oneOff = resolveDraftLanguage("en", { chosen: "es" })!;
  assert.equal(oneOff.source, "chosen");
  assert.deepEqual(preferredCheckbox(null, oneOff.language, oneOff.language), { checked: false, replaces: false });
});

test("save-as-preferred checkbox: replacing a stored value is shown unchecked with the replace help", () => {
  for (const stored of LANGUAGE_CHOICES) {
    assert.deepEqual(preferredCheckbox(stored, other(stored), stored), { checked: false, replaces: true });
    assert.deepEqual(preferredCheckbox(stored, other(stored), other(stored)), { checked: false, replaces: true }, "reopened on a one-off against a stored preference");
  }
});

test("the 'cargado por' stamp quotes the history row, and is absent (never 'cargado por ?') when there is none", () => {
  assert.deepEqual(preferredStamp({ byName: "Mariel Sosa", at: new Date("2026-10-27T15:00:00Z") }), { by: "Mariel Sosa", when: "27 oct" });
  assert.deepEqual(preferredStamp({ byName: null, at: new Date("2026-10-27T15:00:00Z") }), { by: "?", when: "27 oct" }, "a BD that no longer exists");
  assert.equal(preferredStamp({ byName: null, at: null }), null, "a preference with no history row (set by SQL or an import)");
});
