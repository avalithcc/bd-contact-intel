import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSequenceDraftInput,
  draftLanguageForMarket,
  draftSignals,
  senderIdentity,
  type SequenceDraftInputArgs,
} from "@/lib/sequences/draftInput";
import { buildOutreachMessagePrompt } from "@/lib/outreach/messagePrompt";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { MARKETS } from "@/lib/hiring/markets";

const base: SequenceDraftInputArgs = {
  person: { firstName: "Ana", lastName: "Lee", jobTitle: "VP Engineering", roleGroup: null, industry: null, companyKey: "acme" },
  connection: null,
  signalBodies: [],
  company: null,
  senderName: "Cristian Civita",
  senderTitle: "COO at Avalith",
};

test("the language is decided by the recipient market: us -> en, latam -> es, other -> none", () => {
  assert.equal(draftLanguageForMarket("us"), "en");
  assert.equal(draftLanguageForMarket("latam"), "es");
  assert.equal(draftLanguageForMarket("other"), null);
});

test("the built input carries the market's language on the email channel", () => {
  const us = buildSequenceDraftInput(base, "us");
  assert.equal(us?.language, "en");
  assert.equal(us?.channel, "email");
  assert.equal(buildSequenceDraftInput(base, "latam")?.language, "es");
});

test("a market with no language yields no input at all, so the generator is unreachable for it", () => {
  assert.equal(buildSequenceDraftInput(base, "other"), null);
});

test("a US member can never be drafted in Spanish, whatever the args say", () => {
  const input = buildSequenceDraftInput({ ...base, language: "es", channel: "linkedin" } as SequenceDraftInputArgs, "us");
  assert.ok(input);
  assert.equal(input.language, "en");
  assert.equal(input.channel, "email");
  const { system } = buildOutreachMessagePrompt(input);
  assert.match(system, /Write in natural, professional English/);
  assert.doesNotMatch(system, /Write in neutral, professional Spanish/);
});

test("a LATAM member gets the neutral professional Spanish instruction, not the Rioplatense DM voice", () => {
  const { system } = buildOutreachMessagePrompt(buildSequenceDraftInput(base, "latam")!);
  assert.match(system, /Write in neutral, professional Spanish/);
  assert.doesNotMatch(system, /Rioplatense tone \(voseo/);
});

test("the reminder purpose flows into the input and the language still comes only from the market", () => {
  assert.equal(buildSequenceDraftInput(base, "us")!.purpose, "first");
  const reminder = buildSequenceDraftInput(base, "us", "reminder")!;
  assert.deepEqual([reminder.purpose, reminder.language, reminder.channel], ["reminder", "en", "email"]);
  assert.equal(buildSequenceDraftInput(base, "latam", "reminder")?.language, "es");
  assert.equal(buildSequenceDraftInput(base, "other", "reminder"), null);
});

test("a reminder for a US member is an English short nudge with the shared guardrails", () => {
  const { system } = buildOutreachMessagePrompt(buildSequenceDraftInput(base, "us", "reminder")!);
  assert.match(system, /25-50 words/);
  assert.match(system, /Write in natural, professional English/);
  assert.match(system, /Never invent facts, numbers, client names/);
  assert.doesNotMatch(system, /Hola Gonzalo/);
});

test("chips come from the generator input: no signal that was not handed to the prompt", () => {
  assert.deepEqual(draftSignals(buildSequenceDraftInput(base, "us")!), []);
  const withNote = buildSequenceDraftInput({ ...base, signalBodies: ["Promoted to VP in May"] }, "us")!;
  assert.deepEqual(draftSignals(withNote), [{ kind: "notesPresent", count: 1 }]);
});

test("a leadership contact yields the leadership chip and nothing else", () => {
  const input = buildSequenceDraftInput({ ...base, person: { ...base.person, roleGroup: "c_level_tech" } }, "us")!;
  assert.deepEqual(draftSignals(input), [{ kind: "leadership" }]);
});

test("the sender title follows the draft language, and only the owner has one", () => {
  assert.deepEqual(senderIdentity("Cristian Civita", "en"), { senderName: "Cristian Civita", senderTitle: "COO at Avalith" });
  assert.deepEqual(senderIdentity("Cristian Civita", "es"), { senderName: "Cristian Civita", senderTitle: "COO de Avalith" });
  assert.deepEqual(senderIdentity("  Maria  ", "en"), { senderName: "Maria", senderTitle: undefined });
});

test("language and postal address can never disagree: a market has a draft language iff it has a footer entry", () => {
  for (const market of MARKETS) {
    assert.equal(draftLanguageForMarket(market) !== null, Object.hasOwn(COMPLIANCE_CONFIG, market), market);
  }
});
