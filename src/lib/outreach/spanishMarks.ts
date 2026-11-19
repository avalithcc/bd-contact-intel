/**
 * Spanish needs an opening ¿ or ¡, and the model keeps leaving them out: both drafts the automatic path wrote on
 * 2026-11-19 ended a question with "?" and no "¿". It is an orthographic error every Spanish reader notices.
 *
 * This is a deterministic repair rather than a prompt line or a retry, for three reasons. A prompt instruction is a
 * request, not a constraint - 78.6% of live subjects once broke a rule that was written in the prompt. A retry
 * spends a model call to fix punctuation. And a repair cannot change meaning: it inserts a mark, nothing else.
 *
 * Only for Spanish. English text is returned untouched.
 */

/** A sentence ends at . ! ? or a newline; the next sentence starts after any closing quote/bracket and whitespace. */
const SENTENCE = /[^.!?\n]*[?!]/g;

function openingFor(sentence: string): "¿" | "¡" | null {
  const closer = sentence.trimEnd().slice(-1);
  if (closer === "?" && !sentence.includes("¿")) return "¿";
  if (closer === "!" && !sentence.includes("¡")) return "¡";
  return null;
}

/**
 * Adds the missing ¿ or ¡ to every Spanish sentence that ends in ? or !. A sentence that already carries its opening
 * mark is left alone, so running this twice changes nothing.
 */
export function addSpanishOpeningMarks(text: string, language: string | null | undefined): string {
  if (language !== "es" || !text) return text;
  return text.replace(SENTENCE, (sentence) => {
    const mark = openingFor(sentence);
    if (!mark) return sentence;
    // Keep the leading whitespace where it is: the mark belongs to the words, not to the gap before them.
    const lead = sentence.length - sentence.trimStart().length;
    return sentence.slice(0, lead) + mark + sentence.slice(lead);
  });
}

/** The sentences that still lack an opening mark. Empty when the text is correct, or not Spanish. */
export function missingSpanishOpeningMarks(text: string, language: string | null | undefined): string[] {
  if (language !== "es" || !text) return [];
  return (text.match(SENTENCE) ?? []).filter((s) => openingFor(s) !== null).map((s) => s.trim());
}
