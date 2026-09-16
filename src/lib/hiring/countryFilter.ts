/**
 * Country code -> lowercase substrings matched (case-insensitively) against
 * a posting's free-text location field. Extend as target companies with a
 * `countryFilter` are added; a country not listed here falls back to
 * matching the code itself as a substring.
 */
const COUNTRY_MATCH_TERMS: Record<string, string[]> = {
  AR: ["argentina", "buenos aires"],
};

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
  const terms =
    COUNTRY_MATCH_TERMS[countryFilter.toUpperCase()] ?? [countryFilter.toLowerCase()];
  const loc = location.toLowerCase();
  return terms.some((term) => loc.includes(term));
}
