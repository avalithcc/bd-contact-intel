/**
 * Alias resolution for the `/companies` list's contact count.
 *
 * A merge (scripts/merge-companies.ts) writes one `company_alias` row per
 * merged-away key, `alias_key -> company_key`, so a later import that still
 * normalizes an employer to the dead key lands on the survivor. A person whose
 * `person.company_key` holds such an alias key is "at" the canonical company,
 * but a plain `company_key = <canonical>` match cannot see them.
 *
 * LATENT TODAY (measured read-only against production 2026-10-09): 62
 * `company_alias` rows and 0 people sitting on an alias key, because the merge
 * script repoints every `person.company_key` to the survivor. It bites the
 * first time an import writes a dead key — which is exactly what aliases
 * exist to absorb.
 *
 * Same concept and direction as `ResolvedHiringCompany.matchKeys` in
 * src/lib/hiring/queries.ts ("the target company's own key plus any
 * company_alias rows pointing at it"). It is kept separate on purpose: hiring
 * derives its keys from open postings inside its own loop and keeps a `Set`
 * per company, while this builds from the list page's keys and must be
 * deterministic and testable alone. Do not confuse the two lookups: the
 * hiring INDEX is keyed by every alias, so the list's "hiring" view needs no
 * alias step; the contact count has no such index.
 *
 * Pure — no DB import, so it is unit-testable without DATABASE_URL (see
 * tests/unit/companyAliasResolution.test.ts). The accessor that reads
 * `company_alias` lives in aliasResolutionDb.ts. The three single-company
 * reads on the record do NOT use this module: they resolve aliases inside the
 * statement itself (`companyContactsCondition`, contactCounts.ts) because a
 * separate alias read would cost them a round trip each.
 */
export interface CompanyAliasRow {
  aliasKey: string;
  companyKey: string;
}

/**
 * Canonical company key -> every `person.company_key` value that counts as
 * "at this company": its own key first, then its aliases in ascending order.
 *
 * - Every requested key gets an entry, even with zero aliases.
 * - An alias row for a company that was not requested is ignored.
 * - Duplicate alias rows collapse into the single entry for that key, so
 *   summing can never count a key twice.
 * - An alias equal to its own company key is skipped. The SQL rule already
 *   drops that row (the company is live by the FK), so this only guards a
 *   hand-fed row, which would otherwise yield `[k, k]` and make
 *   `sumCountsByCompany` count it twice.
 * - The output order does not depend on the order of `aliasRows` or
 *   `canonicalKeys`.
 *
 * It does NOT decide which alias rows are real: an alias key that is itself a
 * live company key is excluded by the database (aliasRule.ts), the same rule
 * the record uses, so this stays page-independent. Callers must feed it rows
 * from `getCompanyAliasRows`. `alias_key` is the table's primary key, so each
 * raw key belongs to at most one company and summing cannot double count.
 *
 * Never mutates its inputs; calling it twice with the same input gives the
 * same result.
 */
export function buildCompanyMatchKeys(canonicalKeys: readonly string[], aliasRows: readonly CompanyAliasRow[]): Map<string, string[]> {
  const requested = new Set(canonicalKeys);
  const aliasesByCompany = new Map<string, Set<string>>();
  for (const row of aliasRows) {
    if (!requested.has(row.companyKey) || row.aliasKey === row.companyKey) continue;
    const set = aliasesByCompany.get(row.companyKey) ?? new Set<string>();
    set.add(row.aliasKey);
    aliasesByCompany.set(row.companyKey, set);
  }
  const map = new Map<string, string[]>();
  for (const key of requested) {
    map.set(key, [key, ...[...(aliasesByCompany.get(key) ?? [])].sort()]);
  }
  return map;
}

export interface RawKeyCount {
  companyKey: string | null;
  count: number;
}

/**
 * Folds per-`person.company_key` counts into per-canonical-company totals.
 * `matchKeys` must come from `buildCompanyMatchKeys` (the one producer of that
 * map). Every company in the map gets a total, 0 when nothing matched; rows
 * with a null or unrelated key are ignored.
 */
export function sumCountsByCompany(matchKeys: ReadonlyMap<string, readonly string[]>, rows: readonly RawKeyCount[]): Map<string, number> {
  const countByRawKey = new Map<string, number>();
  for (const row of rows) {
    if (row.companyKey === null) continue;
    countByRawKey.set(row.companyKey, (countByRawKey.get(row.companyKey) ?? 0) + row.count);
  }
  const totals = new Map<string, number>();
  for (const [companyKey, keys] of matchKeys) {
    totals.set(companyKey, keys.reduce((sum, key) => sum + (countByRawKey.get(key) ?? 0), 0));
  }
  return totals;
}
