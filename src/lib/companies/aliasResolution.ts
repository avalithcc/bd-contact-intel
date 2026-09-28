/**
 * Shared alias-resolution step for `/companies` reads that count or list
 * `person` rows for a company (bug: company-contact-counts, see
 * openspec/BACKLOG.md) — a person's `company_key` sometimes normalizes to a
 * `company_alias.alias_key` rather than the target company's own canonical
 * `company_key` (e.g. a legal entity name vs. the brand name used on
 * LinkedIn), so matching `person.company_key` directly against the
 * canonical key alone undercounts.
 *
 * This mirrors the alias-resolution already used by the hiring crossover
 * (see src/lib/hiring/queries.ts#resolveHiringCompanies's `matchKeys`) —
 * same `alias_key -> company_key` direction, same "canonical key plus every
 * alias pointing at it" match set — factored out here so every `/companies`
 * read that needs it (the list's batched contact count, the record's
 * contact count and its people list) builds the match-key map the same way
 * instead of each inventing its own.
 *
 * Pure — no DB import here on purpose, so it's unit-testable without
 * DATABASE_URL (see tests/unit/companyAliasResolution.test.ts). The DB
 * accessor that fetches `company_alias` rows lives in
 * src/lib/companies/aliasResolutionDb.ts.
 */
export interface CompanyAliasRow {
  aliasKey: string;
  companyKey: string;
}

/**
 * Canonical company key -> every `person.company_key` value that should
 * count as "at this company" (its own canonical key plus every alias
 * pointing at it, in that order). Every key in `canonicalKeys` gets an
 * entry, even with zero aliases, so callers can rely on `.get(key)` never
 * being `undefined` for a key they passed in. An alias whose `companyKey`
 * isn't one of `canonicalKeys` is ignored — it belongs to a company this
 * caller didn't ask about.
 *
 * Pure: never mutates `canonicalKeys` or `aliasRows`, and calling it twice
 * with the same input returns an equivalent map both times (see
 * tests/unit/companyAliasResolution.test.ts).
 */
export function buildCompanyMatchKeys(
  canonicalKeys: string[],
  aliasRows: CompanyAliasRow[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const key of canonicalKeys) map.set(key, [key]);
  for (const alias of aliasRows) {
    const existing = map.get(alias.companyKey);
    if (existing) existing.push(alias.aliasKey);
  }
  return map;
}
