/**
 * Whether a regenerated subject is genuinely different from one the BD already rejected.
 *
 * Byte inequality is the wrong test: "Backend, Salesforce y pagos en LATAM y Madrid" and "Salesforce, backend y pagos
 * en Madrid y LATAM" are the same subject to a person. Two subjects are the same when they use the same set of
 * significant words, ignoring case, accents, punctuation, word order and a small stopword list.
 */
const STOPWORDS = new Set([
  "y", "e", "o", "u", "en", "de", "del", "la", "el", "los", "las", "un", "una", "para", "por", "con", "a", "al",
  "and", "or", "in", "of", "the", "for", "to", "at", "on", "with", "an",
]);

export function significantWords(subject: string): Set<string> {
  const words = subject
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "" && !STOPWORDS.has(w));
  return new Set(words);
}

export function isSameSubject(a: string, b: string): boolean {
  const x = significantWords(a);
  const y = significantWords(b);
  if (x.size !== y.size) return false;
  for (const w of x) if (!y.has(w)) return false;
  return true;
}

export function repeatsAny(candidate: string, rejected: readonly string[]): boolean {
  return rejected.some((r) => isSameSubject(candidate, r));
}
