import test from "node:test";
import assert from "node:assert/strict";
import { buildOutreachMessagePrompt } from "@/lib/outreach/messagePrompt";
import { CASES } from "./fixtures/messagePromptCases";

/**
 * The tone EXEMPLAR, not the written rule, is what the model copies — a failure
 * mode this prompt has already hit twice (see the comments in messagePrompt.ts).
 * `languageInstruction` has always said "warm but not overly casual", and an
 * English exemplar opening "how's it going?" still produced chummy drafts,
 * because only the Spanish exemplar was cleaned on 2026-10-26. These tests pin
 * the exemplar itself, in both languages and both channels.
 *
 * Inputs reuse the characterization fixtures (the shapes the live callers send),
 * with only `language` and `channel` overridden.
 */
const CHUMMY = [/how's it going/i, /what's up/i, /hey there/i, /cómo va\b/i, /qué tal todo/i, /te copa/i, /te cierra una llamada/i];
const base = CASES[Object.keys(CASES)[0]!]!;

function systemFor(language: "es" | "en", channel: "email" | "linkedin") {
  return buildOutreachMessagePrompt({ ...base, language, channel }).system;
}

for (const language of ["es", "en"] as const) {
  for (const channel of ["email", "linkedin"] as const) {
    test(`the ${language}/${channel} tone exemplar opens with a courtesy, not a greeting between friends`, () => {
      const system = systemFor(language, channel);
      for (const pattern of CHUMMY) {
        assert.ok(!pattern.test(system), `${language}/${channel} exemplar matches ${pattern}`);
      }
    });
  }
}

test("the English LinkedIn exemplar mirrors the Spanish courtesy opener", () => {
  assert.match(systemFor("en", "linkedin"), /good to meet you/);
  assert.match(systemFor("es", "linkedin"), /un gusto saludarte/);
});
