import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addSpanishOpeningMarks, missingSpanishOpeningMarks } from "@/lib/outreach/spanishMarks";

describe("Spanish opens its questions", () => {
  // Both drafts the automatic path wrote on 2026-11-19 ended a question with "?" and no "¿". A prompt line would not
  // have stopped it: 78.6% of live subjects once broke a rule that was written in the prompt. This is a repair, so
  // the only thing it can do is add a mark.
  it("adds the opening mark to a Spanish question and leaves a correct one alone", () => {
    assert.equal(addSpanishOpeningMarks("¿Tendrías 15 minutos?", "es"), "¿Tendrías 15 minutos?");
    assert.equal(
      addSpanishOpeningMarks("Vi que Tenpo busca gente. Tendrías 15 minutos?", "es"),
      "Vi que Tenpo busca gente. ¿Tendrías 15 minutos?",
    );
    assert.equal(addSpanishOpeningMarks("Qué bueno!", "es"), "¡Qué bueno!");
  });

  it("never touches English, and running it twice changes nothing", () => {
    const en = "Would you have 15 minutes next week?";
    assert.equal(addSpanishOpeningMarks(en, "en"), en);
    const once = addSpanishOpeningMarks("Hola. Tendrías 15 minutos? Gracias!", "es");
    assert.equal(addSpanishOpeningMarks(once, "es"), once);
    assert.equal(once, "Hola. ¿Tendrías 15 minutos? ¡Gracias!");
  });

  it("reports what is still missing, which is what a test can assert on a real draft", () => {
    assert.deepEqual(missingSpanishOpeningMarks("Hola. Tendrías 15 minutos?", "es"), ["Tendrías 15 minutos?"]);
    assert.deepEqual(missingSpanishOpeningMarks("Hola. ¿Tendrías 15 minutos?", "es"), []);
    assert.deepEqual(missingSpanishOpeningMarks("Any time?", "en"), []);
  });
});
