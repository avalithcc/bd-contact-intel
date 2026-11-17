import assert from "node:assert/strict";
import test from "node:test";
import type { ComplianceAudienceInputs } from "@/lib/sequences/complianceAudience";
import { buildMemberAudience } from "@/lib/sequences/audienceView";
import { countryLine, draftDrift, languagePick } from "@/lib/sequences/audienceCard";
import type { DetailDraft, DetailMember } from "@/lib/sequences/detailQueries";

const draft = (language: "es" | "en" | null): DetailDraft => ({ subject: "S", body: "B", language, edited: false, generatedAt: new Date("2026-10-10T09:00:00Z"), editedAt: null, reviewedAt: null, approvedAt: null, scheduledFor: null });
const inputs = (over: Partial<ComplianceAudienceInputs> = {}): ComplianceAudienceInputs => ({ mobilePhone: null, phone: null, personCountry: null, companyCountry: null, postingMarkets: [], rosterCountries: [], ...over });
// The audience is built by the real producer, never by hand.
const member = (audience: Partial<ComplianceAudienceInputs>, over: Partial<DetailMember> = {}): DetailMember => ({
  memberId: "m1", personId: "p1", state: "drafted", holdReason: null, firstName: "Marina", lastName: "Q", jobTitle: null, company: "Baufest", companyKey: "baufest",
  email: "m@b.test", emailVerified: true, openIt: 0, florida: false, leadership: false, lastContactAt: null, repliedAt: null, sentAt: null, reminderDueAt: null,
  discardedAt: null, discardReason: null, discardedByBdId: null, draft: draft("es"), reminderDraft: null, audience: buildMemberAudience(inputs(audience)),
  languageChoice: null, preferredLanguage: null, personCountry: null, companyCountry: null, ...over,
});

test("draftDrift: a draft written in the language that applies today reports nothing", () => {
  assert.equal(draftDrift(member({ personCountry: "Argentina" }, { draft: draft("es") })), null);
});

test("draftDrift: a draft in Spanish for a person now resolved to the United States reports English and the Miami address", () => {
  assert.deepEqual(draftDrift(member({ personCountry: "United States" }, { draft: draft("es") })), { draft: "es", now: "en", address: "miami" });
});

test("draftDrift: a member with no draft reports nothing", () => {
  assert.equal(draftDrift(member({ personCountry: "United States" }, { draft: null })), null);
});

test("draftDrift: a draft whose stored language is unknown reports nothing, because nothing proves what it is written in", () => {
  assert.equal(draftDrift(member({ personCountry: "United States" }, { draft: draft(null) })), null);
});

test("draftDrift: an approved draft is not flagged by the card", () => {
  assert.equal(draftDrift(member({ personCountry: "United States" }, { state: "approved" })), null);
});

test("draftDrift: the address is the one the audience resolves now, Mar del Plata for Argentina, even when only the language drifted", () => {
  const m = member({ personCountry: "Argentina" }, { draft: draft("en") });
  assert.deepEqual(draftDrift(m), { draft: "en", now: "es", address: "mdp" });
});

test("countryLine: the person's own country is returned as stored", () => {
  assert.deepEqual(countryLine(member({ personCountry: "Chile" }, { personCountry: "Chile", companyCountry: "Argentina" })), { person: "Chile", company: null });
});

test("countryLine: a missing or blank own country is null, so the card says no definido", () => {
  assert.equal(countryLine(member({}, { personCountry: null })).person, null);
  assert.equal(countryLine(member({}, { personCountry: "   " })).person, null);
});

test("countryLine: the company is returned, with its key, when its country is what decided the audience", () => {
  const m = member({ companyCountry: "Argentina" }, { companyCountry: "Argentina", company: "Flybondi", companyKey: "flybondi" });
  assert.deepEqual(countryLine(m), { person: null, company: { name: "Flybondi", country: "Argentina", key: "flybondi" } });
});

test("countryLine: the company is hidden when the person's country decided, even if the company has one", () => {
  assert.equal(countryLine(member({ personCountry: "Chile", companyCountry: "Argentina" }, { personCountry: "Chile", companyCountry: "Argentina" })).company, null);
});

test("countryLine: the company is hidden when it decided but has no record to link to", () => {
  assert.equal(countryLine(member({ companyCountry: "Argentina" }, { companyCountry: "Argentina", companyKey: null })).company, null);
});

test("languagePick: picking the language already in force does nothing", () => {
  assert.deepEqual(languagePick(member({ personCountry: "Argentina" }), "es"), { kind: "none" });
});

test("languagePick: picking the other language sets this member's choice", () => {
  assert.deepEqual(languagePick(member({ personCountry: "Argentina" }), "en"), { kind: "set", language: "en" });
});

test("languagePick: picking the resolved language while a choice overrides it clears the choice instead of storing a redundant one", () => {
  const m = member({ personCountry: "Argentina" }, { languageChoice: { language: "en", byName: "Ana", at: null } });
  assert.deepEqual(languagePick(m, "es"), { kind: "reset" });
});
