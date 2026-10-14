/**
 * `purpose` on the shared outreach prompt: a reminder changes ONLY rule 1 (length) and rule 3 (goal), and the
 * reference style follows the draft language. Everything else, including the anti-hallucination and prompt-injection
 * rules, is shared with the first email by construction, so these tests compare the two renderings line by line.
 * The Spanish no-purpose rendering is pinned separately in messagePromptCharacterization.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOutreachMessagePrompt } from "@/lib/outreach/messagePrompt";
import { CASES } from "./fixtures/messagePromptCases";

const BASE = CASES["email-es-full"];
const lines = (s: string) => s.split("\n");
const ruleLine = (system: string, n: number) => lines(system).find((l) => l.startsWith(`${n}. `)) ?? "";

test("no purpose, purpose first, and the pre-change rendering are the same", () => {
  const none = buildOutreachMessagePrompt(BASE);
  assert.deepEqual(buildOutreachMessagePrompt({ ...BASE, purpose: "first" }), none);
  assert.match(ruleLine(none.system, 1), /90-150 words/);
  assert.match(ruleLine(none.system, 3), /first professional email/);
});

test("a reminder targets 25-50 words and drops the 90-150 target", () => {
  const rule1 = ruleLine(buildOutreachMessagePrompt({ ...BASE, purpose: "reminder" }).system, 1);
  assert.match(rule1, /25-50 words/);
  assert.doesNotMatch(rule1, /90-150/);
});

test("a reminder is a follow-up on the same thread, never a first professional email", () => {
  const rule3 = ruleLine(buildOutreachMessagePrompt({ ...BASE, purpose: "reminder" }).system, 3);
  assert.doesNotMatch(rule3, /first professional email/);
  assert.match(rule3, /follow-up/i);
  assert.match(rule3, /not replied/i);
});

const preamble = (system: string) => lines(system).find((l) => l.startsWith("You write ")) ?? "";

test("the reminder preamble describes a follow-up on an existing thread, never a first-touch email", () => {
  const first = preamble(buildOutreachMessagePrompt(BASE).system);
  const reminder = preamble(buildOutreachMessagePrompt({ ...BASE, purpose: "reminder" }).system);
  assert.match(first, /first-touch emails/);
  assert.doesNotMatch(reminder, /first-touch/);
  assert.match(reminder, /short, peer-to-peer follow-up emails/);
  assert.match(reminder, /existing email thread/);
  assert.match(reminder, /on behalf of a Business Developer at Avalith, a software engineering company\. Follow these rules exactly:$/);
});

test("the LinkedIn preamble is the same whatever the purpose", () => {
  const dm = CASES["linkedin-es-full"];
  assert.equal(preamble(buildOutreachMessagePrompt({ ...dm, purpose: "reminder" }).system), preamble(buildOutreachMessagePrompt(dm).system));
});

test("every line except the preamble and rules 1 and 3 is byte-identical between a first email and a reminder", () => {
  const strip = (system: string) =>
    lines(system).filter((l) => !l.startsWith("You write ") && !l.startsWith("1. ") && !l.startsWith("3. "));
  const first = strip(buildOutreachMessagePrompt(BASE).system);
  const reminder = strip(buildOutreachMessagePrompt({ ...BASE, purpose: "reminder" }).system);
  assert.deepEqual(reminder, first);
  assert.ok(first.some((l) => l.includes("Never invent facts, numbers, client names")));
  assert.ok(first.some((l) => l.includes("<<<CONTACT_NOTES_START>>>")));
  assert.ok(first.some((l) => l.includes("Avalith — company facts")));
});

test("the user prompt, with the untrusted history and notes blocks, does not depend on purpose", () => {
  assert.equal(buildOutreachMessagePrompt({ ...BASE, purpose: "reminder" }).prompt, buildOutreachMessagePrompt(BASE).prompt);
});

test("purpose only applies to email: a LinkedIn DM renders the same either way", () => {
  const dm = CASES["linkedin-es-full"];
  assert.deepEqual(buildOutreachMessagePrompt({ ...dm, purpose: "reminder" }), buildOutreachMessagePrompt(dm));
});

test("the reference style follows the language: Spanish keeps its example, English gets an English one", () => {
  for (const channel of ["email", "linkedin"] as const) {
    const es = buildOutreachMessagePrompt({ ...BASE, channel, language: "es" }).system;
    const en = buildOutreachMessagePrompt({ ...BASE, channel, language: "en" }).system;
    assert.match(es, /Hola Gonzalo/);
    assert.match(es, /in Spanish/);
    assert.doesNotMatch(en, /Hola Gonzalo/);
    assert.doesNotMatch(en, /in Spanish, for a FIRST/);
    assert.match(en, /in English, for a FIRST/);
    assert.match(en, /Hi Gonzalo/);
  }
});
