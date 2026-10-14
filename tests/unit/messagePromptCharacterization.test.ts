/**
 * Characterization test: pins, byte for byte, what buildOutreachMessagePrompt renders TODAY for the Spanish inputs the
 * existing live callers send (no `purpose`). The prompt is shared by five callers that generate the app's outreach
 * messages in production, and a regression there has no other test watching it. Goldens in
 * tests/unit/fixtures/messagePromptGolden/ were captured from the unmodified code. Never regenerate them to make a
 * change pass: if this fails, the existing path moved.
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
  test(`existing Spanish caller "${name}" renders the exact pre-change system and user prompt`, () => {
    const rendered = buildOutreachMessagePrompt(CASES[name]);
    const expected = golden(name);
    assert.equal(rendered.system, expected.system);
    assert.equal(rendered.prompt, expected.prompt);
  });
}
