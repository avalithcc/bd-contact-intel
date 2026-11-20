/**
 * Characterization test: pins, byte for byte, what buildOutreachMessagePrompt renders for the Spanish inputs the
 * live callers send (no `purpose`). The prompt is shared by five callers that generate the app's outreach
 * messages in production, and a regression there has no other test watching it. Goldens in
 * tests/unit/fixtures/messagePromptGolden/ were re-captured on 2026-11-20 for an intentional, owner-approved prompt
 * change: Spanish now REQUIRES the opening marks "¿" and "¡" on every channel, where the rule used to ban them, and
 * the exemplar's closing ask became the conditional "¿Tendrías 15 minutos...?". The ban was the cause of the missing
 * "¿" the owner reported on 2026-11-19; addSpanishOpeningMarks had been added to repair the output while this prompt
 * went on ordering the omission. Previously re-captured 2026-11-17 for an intentional, owner-approved prompt
 * change: the subject is now a NOUN FRAGMENT and the headline-shaped example was removed. The owner received
 * "Getnet abre backend y Salesforce en LATAM y España" and found it strange to read - a news bulletin about him
 * rather than a line written to him - and the first shape example was "Affirm suma backend en Card y Fraud", which
 * taught exactly that. Previously re-captured 2026-10-28 (sign-off removal with a signature, the first subject rule,
 * company-name absence instead of "unknown").
 * Do not regenerate them to make an unintended change pass: if this fails, the existing path moved.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildOutreachMessagePrompt } from "@/lib/outreach/messagePrompt";
import { CASES } from "./fixtures/messagePromptCases";

const golden = (name: string) =>
  JSON.parse(readFileSync(join("tests", "unit", "fixtures", "messagePromptGolden", `${name}.json`), "utf8")) as {
    system: string;
    prompt: string;
  };

for (const name of Object.keys(CASES)) {
  test(`existing Spanish caller "${name}" renders the pinned system and user prompt`, () => {
    const rendered = buildOutreachMessagePrompt(CASES[name]);
    const expected = golden(name);
    assert.equal(rendered.system, expected.system);
    assert.equal(rendered.prompt, expected.prompt);
  });
}

/**
 * A contact with no name at all. Production holds 232 of them (measured 2026-10-28, all with an email), and the old
 * code rendered `- First name: the contact` — a placeholder presented AS the name, which the model cannot tell apart
 * from a real one, so a draft could open "Hola the contact,". The two name lines are now dropped entirely instead of
 * being filled with a stand-in, because any sentinel ("unknown" included) has the same defect one word further on.
 * None of those contacts had reached a Sequence, so nothing went out; this keeps it that way.
 */
test("a contact with no name gets no name line, and no placeholder the model could echo", () => {
  const { prompt } = buildOutreachMessagePrompt({ ...CASES["email-es-cold"], contact: { ...CASES["email-es-cold"].contact, firstName: null, lastName: null } });
  assert.ok(!prompt.includes("the contact"), "the old placeholder must not survive anywhere in the prompt");
  assert.ok(!prompt.includes("- First name:"), "a name we do not have must be absent, not filled in");
  assert.ok(!prompt.includes("- Full name:"));
  assert.match(prompt, /- Name: not on file\. Open without a name in the greeting/);
  // The rest of the prompt is unchanged: the section it sits in still reads as a contact block.
  assert.match(prompt, /Contact:\n- Name: not on file[^\n]*\n- Position:/);
});

test("a contact with only a last name still gets both name lines, as before", () => {
  const { prompt } = buildOutreachMessagePrompt({ ...CASES["email-es-cold"], contact: { ...CASES["email-es-cold"].contact, firstName: null, lastName: "Piccolo" } });
  assert.match(prompt, /- First name: Piccolo\n- Full name: Piccolo\n/);
  assert.ok(!prompt.includes("not on file"));
});
