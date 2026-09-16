/**
 * Country code -> match rules applied (case-insensitively) to a posting's
 * free-text location field. `phrases` are matched as substrings; `tokens`
 * are matched as whole words, because ATS providers often emit bare country
 * codes ("Palermo, CABA, ar") and a substring match on a two-letter code
 * would hit unrelated words ("Paraguay", "Barcelona").
 * Extend as target companies with a `countryFilter` are added.
 */
const COUNTRY_MATCH_RULES: Record<string, { phrases: string[]; tokens: string[] }> = {
  AR: {
    phrases: ["argentina", "buenos aires"],
    tokens: ["ar", "arg", "caba", "bsas"],
  },
};

/** Splits a location into lowercase word tokens, dropping punctuation. */
function tokenize(location: string): string[] {
  return location
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Whether `location` matches `countryFilter`. A null/undefined
 * `countryFilter` means "no filter" (always matches). A non-blank filter
 * with a blank `location` never matches, since there's nothing to check.
 */
export function matchesCountry(
  location: string | null | undefined,
  countryFilter: string | null | undefined,
): boolean {
  if (!countryFilter) return true;
  if (!location) return false;

  const code = countryFilter.toUpperCase();
  const rules = COUNTRY_MATCH_RULES[code] ?? {
    phrases: [],
    tokens: [countryFilter.toLowerCase()],
  };

  const loc = location.toLowerCase();
  if (rules.phrases.some((phrase) => loc.includes(phrase))) return true;

  const tokens = new Set(tokenize(location));
  return rules.tokens.some((token) => tokens.has(token));
}
