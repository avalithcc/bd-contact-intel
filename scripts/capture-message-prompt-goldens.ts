// Re-captures tests/unit/fixtures/messagePromptGolden/*.json from the CURRENT prompt.
//
// Run this ONLY for an intentional, owner-approved prompt change, and only after reading the diff — the
// characterization test exists so a prompt change cannot happen by accident. Captured 2026-11-16 for the
// follow-up to the owner's report that subjects were abstract and bodies pitched US timezones to LATAM
// companies: rule 5's timezone clause became conditional, and the subject rule's length and banned-vocabulary
// lines are now generated from src/lib/outreach/subjectRules.ts, the same constant the generator enforces.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOutreachMessagePrompt } from "@/lib/outreach/messagePrompt";
import { CASES } from "../tests/unit/fixtures/messagePromptCases";

for (const [name, input] of Object.entries(CASES)) {
  const { system, prompt } = buildOutreachMessagePrompt(input);
  const path = join("tests", "unit", "fixtures", "messagePromptGolden", `${name}.json`);
  writeFileSync(path, `${JSON.stringify({ system, prompt }, null, 2)}\n`, "utf8");
  console.log(`captured ${path}`);
}
