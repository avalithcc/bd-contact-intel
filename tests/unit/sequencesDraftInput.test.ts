import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSequenceDraftInput,
  draftSignals,
  senderIdentity,
  type SequenceDraftInputArgs,
} from "@/lib/sequences/draftInput";
import { buildOutreachMessagePrompt } from "@/lib/outreach/messagePrompt";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { RECOGNIZED_COUNTRIES, resolveComplianceAudience, type ComplianceAudience } from "@/lib/sequences/complianceAudience";

const EN: ComplianceAudience = { address: "miami", language: "en" };
const ES: ComplianceAudience = { address: "mdp", language: "es" };

const base: SequenceDraftInputArgs = {
  person: { firstName: "Ana", lastName: "Lee", jobTitle: "VP Engineering", roleGroup: null, industry: null, companyKey: "acme" },
  connection: null,
  signalBodies: [],
  company: null,
  senderName: "Cristian Civita",
  senderTitle: "COO at Avalith",
};

test("the built input carries the audience's language on the email channel", () => {
  const us = buildSequenceDraftInput(base, EN);
  assert.equal(us?.language, "en");
  assert.equal(us?.channel, "email");
  assert.equal(buildSequenceDraftInput(base, ES)?.language, "es");
});

test("a contact with no audience yields no input at all, so the generator is unreachable for it", () => {
  assert.equal(buildSequenceDraftInput(base, null), null);
});

test("a US member can never be drafted in Spanish, whatever the args say", () => {
  const input = buildSequenceDraftInput({ ...base, language: "es", channel: "linkedin" } as SequenceDraftInputArgs, EN);
  assert.ok(input);
  assert.equal(input.language, "en");
  assert.equal(input.channel, "email");
  const { system } = buildOutreachMessagePrompt(input);
  assert.match(system, /Write in natural, professional English/);
  assert.doesNotMatch(system, /Write in neutral, professional Spanish/);
});

test("a LATAM member gets the neutral professional Spanish instruction, not the Rioplatense DM voice", () => {
  const { system } = buildOutreachMessagePrompt(buildSequenceDraftInput(base, ES)!);
  assert.match(system, /Write in neutral, professional Spanish/);
  assert.doesNotMatch(system, /Rioplatense tone \(voseo/);
});

test("the reminder purpose flows into the input and the language still comes only from the audience", () => {
  assert.equal(buildSequenceDraftInput(base, EN)!.purpose, "first");
  const reminder = buildSequenceDraftInput(base, EN, "reminder")!;
  assert.deepEqual([reminder.purpose, reminder.language, reminder.channel], ["reminder", "en", "email"]);
  assert.equal(buildSequenceDraftInput(base, ES, "reminder")?.language, "es");
  assert.equal(buildSequenceDraftInput(base, null, "reminder"), null);
});

test("a reminder for a US member is an English short nudge with the shared guardrails", () => {
  const { system } = buildOutreachMessagePrompt(buildSequenceDraftInput(base, EN, "reminder")!);
  assert.match(system, /25-50 words/);
  assert.match(system, /Write in natural, professional English/);
  assert.match(system, /Never invent facts, numbers, client names/);
  assert.doesNotMatch(system, /Hola Gonzalo/);
});

test("chips come from the generator input: no signal that was not handed to the prompt", () => {
  assert.deepEqual(draftSignals(buildSequenceDraftInput(base, EN)!), []);
  const withNote = buildSequenceDraftInput({ ...base, signalBodies: ["Promoted to VP in May"] }, EN)!;
  assert.deepEqual(draftSignals(withNote), [{ kind: "notesPresent", count: 1 }]);
});

test("a leadership contact yields the leadership chip and nothing else", () => {
  const input = buildSequenceDraftInput({ ...base, person: { ...base.person, roleGroup: "c_level_tech" } }, EN)!;
  assert.deepEqual(draftSignals(input), [{ kind: "leadership" }]);
});

test("the sender title follows the draft language, and only the owner has one", () => {
  assert.deepEqual(senderIdentity("Cristian Civita", "en"), { senderName: "Cristian Civita", senderTitle: "COO at Avalith" });
  assert.deepEqual(senderIdentity("Cristian Civita", "es"), { senderName: "Cristian Civita", senderTitle: "COO de Avalith" });
  assert.deepEqual(senderIdentity("  Maria  ", "en"), { senderName: "Maria", senderTitle: undefined });
});

test("language and postal address are two fields of ONE audience: every recognized country has both, in the config", () => {
  for (const { iso, names } of RECOGNIZED_COUNTRIES) {
    const a = resolveComplianceAudience({ mobilePhone: null, phone: null, rosterCountries: [], personCountry: names[0] });
    if (!a) continue; // an embargoed jurisdiction: held, nothing to compose
    assert.ok(Object.hasOwn(COMPLIANCE_CONFIG, a.address), `${iso} resolves to an address with no config entry`);
    assert.equal(buildSequenceDraftInput(base, a)?.language, a.language, iso);
  }
});
