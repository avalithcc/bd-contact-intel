/**
 * Owner decision: no informal voseo or slang in ANY outgoing prospect message, on any channel. These tests pin the
 * invariant across every (channel x language x purpose) prompt, not one string, so a new slang phrase fails too.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOutreachMessagePrompt, type BuildOutreachMessagePromptInput } from "@/lib/outreach/messagePrompt";

const BASE: BuildOutreachMessagePromptInput = {
  contact: { firstName: "Ana", lastName: "Gomez", position: "VP Engineering", roleGroup: "eng_leadership", isLeadership: true, connectedOn: "2024-01-01" },
  company: null,
  history: [],
  notes: [],
  senderName: "Cristian Civita",
  senderTitle: "COO de Avalith",
  language: "es",
  channel: "email",
};

const CHANNELS = ["email", "linkedin"] as const;
const LANGUAGES = ["es", "en", "pt"] as const;

// Two DISTINCT failure modes live here, so extend the right list: REJECTED pins regional vocabulary and informal register
// by PHRASE (match the phrase, never the bare word: "chicos" can be fine in another sense), and VOSEO_OR_SLANG below
// covers voseo conjugation and Argentine colloquialisms.
const REJECTED = [/te cierra/i, /te copa/i, /cómo va\?/i, /charlar/i, /rioplatense/i, /voseo/i, /equipos chicos/i, /bastante gente/i];
// The general rule: voseo conjugations and Argentine colloquialisms. Future-tense "-ás" (tendrás) is valid neutral Spanish, so it is not listed.
const VOSEO_OR_SLANG =
  /\b(vos|tenés|querés|podés|sabés|estás viendo|mirá|fijate|contame|decime|vení|dale|che|bárbaro|laburo|copa|charlemos|charlar|te cierra|cómo va)\b/i;

for (const channel of CHANNELS) {
  for (const language of LANGUAGES) {
    for (const purpose of channel === "email" ? (["first", "reminder"] as const) : (["first"] as const)) {
      test(`no voseo or slang in the ${channel}/${language}/${purpose} prompt`, () => {
        const { system } = buildOutreachMessagePrompt({ ...BASE, channel, language, purpose });
        for (const re of REJECTED) assert.doesNotMatch(system, re);
        assert.doesNotMatch(system, VOSEO_OR_SLANG);
      });
    }
  }
}

// The call length is a FACT the owner chose (15 minutes), not copy, so it must be the SAME number everywhere the prompt
// mentions one — rule and exemplar alike, in every language. This is the test that was missing on 2026-10-22: the
// exemplar was changed to 15 while the closing-ask RULE still said "~20 minutes", and 11 of 11 regenerated drafts asked
// for 20, because the model follows a rule and is told the exemplar is "tone example only, do not copy verbatim". The
// register test below could not catch it: it pins /20 minutos/, the SPANISH spelling, while the rules are written in
// English. So match the unit in BOTH languages, and report whatever wrong figure is found instead of guessing which one.
const DURATION = /(\d+)[\s-]?minut(?:e|o)s?/gi;

for (const channel of CHANNELS) {
  for (const language of LANGUAGES) {
    for (const purpose of channel === "email" ? (["first", "reminder"] as const) : (["first"] as const)) {
      test(`every call length the ${channel}/${language}/${purpose} prompt mentions is 15 minutes`, () => {
        const { system } = buildOutreachMessagePrompt({ ...BASE, channel, language, purpose });
        const wrong = [...system.matchAll(DURATION)].map((m) => m[1]).filter((n) => n !== "15");
        assert.deepEqual(wrong, [], `the prompt asks for ${wrong.join(", ")} minutes somewhere instead of 15`);
      });
    }
  }
}

test("the Spanish email exemplar uses the owner-approved call to action verbatim", () => {
  const { system } = buildOutreachMessagePrompt({ ...BASE, channel: "email", language: "es" });
  assert.ok(system.includes("Tendrás 15 minutos la semana próxima para conversar y ver si podemos ayudarlos en alguna oportunidad?"));
  assert.doesNotMatch(system, /20 minutos/);
});

test("the Spanish LinkedIn prompt is neutral, introduces the sender by name and proposes 15 minutes", () => {
  const { system } = buildOutreachMessagePrompt({ ...BASE, channel: "linkedin", language: "es" });
  assert.match(system, /neutral, professional Spanish/);
  assert.match(system, /never use the opening marks "¿" or "¡"/i);
  assert.match(system, /Soy Cristian Civita, COO de Avalith/);
  assert.match(system, /15 minutos/);
});

test("the prompt builder is pure: the same input twice gives the same output", () => {
  const input = { ...BASE, channel: "linkedin" as const };
  const snapshot = JSON.stringify(input);
  const a = buildOutreachMessagePrompt(input);
  const b = buildOutreachMessagePrompt(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snapshot);
});
