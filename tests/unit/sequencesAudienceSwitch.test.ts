/**
 * The owner's compliance rules (decided 2026-10-20) pinned END TO END through the real producers: the audience resolver,
 * the draft input builder, the footer composer and the pre-send gate. Nothing here builds a footer or a language by hand,
 * so a caller that stops reading the audience (or a config whose addresses are swapped) fails here, not in production.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { LATAM_COUNTRY_NAMES } from "@/lib/hiring/markets";
import { resolveComplianceAudience, type ComplianceAudience, type ComplianceAudienceInputs } from "@/lib/sequences/complianceAudience";
import { bodyHasFooter } from "@/lib/sequences/complianceFooter";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { composeDraft, footerRemovedOnSave } from "@/lib/sequences/draftCompose";
import { buildSequenceDraftInput, type SequenceDraftInputArgs } from "@/lib/sequences/draftInput";
import { evaluatePreSendChecks, type PreSendFacts } from "@/lib/sequences/preSendChecks";
import { evaluateRosterAdds } from "@/lib/sequences/rosterGuards";
import { countryFacts } from "@/lib/sequences/pickerQuery";
import { buildUnsubscribeUrl, generateUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

const MDP = "Avalith, Formosa 2531, B7600 Mar del Plata, Buenos Aires, Argentina";
const MIAMI = "Avalith Corporation, 470 Ansin Blvd Ste G, Hallandale, FL 33009, USA";
const URL_OK = buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken());
const NOW = new Date("2026-10-15T14:00:00Z");
const ARGS: SequenceDraftInputArgs = {
  person: { firstName: "Ana", lastName: "Lee", jobTitle: "VP Engineering", roleGroup: null, industry: null, companyKey: "acme" },
  connection: null, signalBodies: [], company: null, senderName: "Cristian Civita", senderTitle: "COO at Avalith",
};

const inputs = (over: Partial<ComplianceAudienceInputs>): ComplianceAudienceInputs => ({ mobilePhone: null, phone: null, rosterCountries: [], ...over });

const resolveOrNull = (over: Partial<ComplianceAudienceInputs>): ComplianceAudience | null => resolveComplianceAudience(inputs(over));

/** What a contact's draft really carries: the language the generator is told, and the body the BD approves. */
function draftOf(over: Partial<ComplianceAudienceInputs>) {
  const audience = resolveComplianceAudience(inputs(over));
  if (!audience) return null;
  const prompt = buildSequenceDraftInput(ARGS, audience);
  const draft = composeDraft({ subject: "Hi", body: "Hello there." }, audience.address, audience.language, URL_OK);
  assert.ok(prompt && draft);
  return { language: prompt.language, body: draft.body, address: audience.address };
}

test("an Argentine contact's draft carries the Mar del Plata address, in Spanish", () => {
  const d = draftOf({ personCountry: "Argentina" });
  assert.ok(d);
  assert.equal(d.language, "es");
  assert.ok(d.body.includes(MDP) && !d.body.includes("Ansin"));
});

test("a Mexican contact's draft carries Miami and Spanish", () => {
  const d = draftOf({ personCountry: "Mexico" });
  assert.ok(d);
  assert.equal(d.language, "es");
  assert.ok(d.body.includes(MIAMI) && !d.body.includes("Mar del Plata"));
});

test("a Spanish contact's draft carries Miami and Spanish (it held before: there is no Madrid address)", () => {
  const d = draftOf({ companyCountry: "Spain" });
  assert.ok(d);
  assert.equal(d.language, "es");
  assert.ok(d.body.includes(MIAMI));
});

test("a Brazilian contact's draft carries Miami and ENGLISH, not Portuguese", () => {
  const d = draftOf({ personCountry: "Brazil" });
  assert.ok(d);
  assert.equal(d.language, "en");
  assert.ok(d.body.includes(MIAMI));
});

test("THE ADDRESS CHANGE: every LATAM country but Argentina used to get Mar del Plata and now gets Miami", () => {
  // 1,736 contacts measured 2026-10-20. If this ever needs to go back, it is an owner decision, not a refactor.
  const others = LATAM_COUNTRY_NAMES.filter((name) => name !== "argentina");
  assert.ok(others.length >= 14);
  for (const name of others) {
    const d = draftOf({ personCountry: name });
    assert.ok(d, name);
    assert.equal(d.address, "miami", name);
    assert.ok(d.body.includes(MIAMI) && !d.body.includes("Formosa"), `${name} must not carry the Mar del Plata address`);
  }
  assert.equal(draftOf({ personCountry: "argentina" })?.address, "mdp");
});

test("the two configured addresses are the two literal strings, under the right keys", () => {
  assert.equal(COMPLIANCE_CONFIG.mdp?.postalAddress, MDP);
  assert.equal(COMPLIANCE_CONFIG.miami?.postalAddress, MIAMI);
  assert.deepEqual(Object.keys(COMPLIANCE_CONFIG).sort(), ["mdp", "miami"]);
});

test("a Cuban contact is HELD at every gate: no draft input, no roster add, no send, no footer warning", () => {
  const audience = resolveOrNull({ personCountry: "Cuba" });
  assert.equal(audience, null);
  assert.equal(buildSequenceDraftInput(ARGS, audience), null, "draft: the generator is unreachable");
  const roster = evaluateRosterAdds(
    [{ personId: "cu", email: "a@b.test", emailStatus: "verified", emailSource: "apollo", mergedIntoId: null, companyKey: null, clientStatus: null, marketMapped: audience !== null }],
    { suppressionRules: [], existingPersonIds: new Set(), activeCountByCompany: new Map() },
  );
  assert.deepEqual(roster.rejected, [{ personId: "cu", reason: "unmapped_market" }], "add guard");
  const footed = composeDraft({ subject: "s", body: "b" }, "miami", "en", URL_OK)!.body;
  const facts: PreSendFacts = {
    step: 1, memberState: "approved", draftApproved: true, merged: false, email: "a@b.test", hasClientStatus: false,
    address: (audience as ComplianceAudience | null)?.address ?? null, body: footed, accountStatus: "connected", activeClaim: null, repliedAt: null,
    inboundReplyAt: null, lastSyncedAt: NOW, step1RfcMessageId: null, step1ThreadId: null, draftLanguage: null, languageToday: null,
  };
  assert.deepEqual(evaluatePreSendChecks(facts, { now: NOW, suppression: [] }), { ok: false, reason: "unmapped_market" }, "send");
});

test("pre-send re-checks the body against the recomputed address: a Miami body does not pass for Mar del Plata", () => {
  const miamiBody = composeDraft({ subject: "s", body: "b" }, "miami", "en", URL_OK)!.body;
  assert.equal(bodyHasFooter(miamiBody, COMPLIANCE_CONFIG, "miami"), true);
  assert.equal(bodyHasFooter(miamiBody, COMPLIANCE_CONFIG, "mdp"), false);
  assert.equal(footerRemovedOnSave(miamiBody, "mdp"), true);
  assert.equal(footerRemovedOnSave("no footer", "miami"), true);
  assert.equal(footerRemovedOnSave(miamiBody, "miami"), false);
});

test("the picker's unmapped list is the resolver's own answer: unrecognized text AND embargoed jurisdictions, nothing located", () => {
  const f = countryFacts(["Spain", "Argentina", "Cuba", "Iran", "Atlantis", "Greater Buenos Aires", "Brazil", "  ", "Canada", "United States"]);
  assert.deepEqual(f.unmapped.sort(), ["atlantis", "cuba", "greater buenos aires", "iran"]);
});

test("the Florida/hiring fact stays on classifyMarket, not on the audience", () => {
  const f = countryFacts(["Spain", "United States", "Florida", "Argentina", "Canada"]);
  assert.deepEqual(f.us.sort(), ["florida", "united states"]);
});
