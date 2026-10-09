/**
 * Preflight for scripts/seed-target-companies.ts's hand-written `aliases`.
 *
 * An alias key that is itself a company key is not an alias for anyone
 * (src/lib/companies/aliasRule.ts: the contact counts ignore such a row so the
 * company keeps its own people). The seed upserts aliases with
 * `on conflict (alias_key) do update set company_key = excluded.company_key`
 * and no look at `company`, and it inserts a bare `company` row for every row
 * that has aliases, so it can create that state in BOTH directions. It is not
 * the only writer of `company_alias` (companyMerge/db.ts is the other; it
 * deletes the dead company row first, in the same transaction), and nothing
 * else in the app enforces the rule: only the paths checked below are covered.
 * Zero collisions exist in production (checked 2026-10-09); 62 alias keys there
 * are exposed to the third reason.
 *
 * Three ways to collide, all reported:
 *  - "live-company": the alias key is already a `company.company_key`.
 *  - "created-by-this-run": the seed inserts a bare `company` row for every row
 *    that has aliases, so an alias equal to such a row's key (including its own
 *    row's key) would be a live company by the time the alias is written. A row
 *    WITHOUT aliases creates only a target_company row, so it does not count.
 *  - "would-shadow-existing-alias": the reverse direction. A row with aliases
 *    makes its own `companyKey` a live company; if that key is already an
 *    `alias_key` in `company_alias` (and not yet a company), the working alias
 *    would stop counting and its contacts would be counted by nobody.
 *    `existingTarget` is where that alias pointed.
 *
 * The script refuses and reports instead of skipping the alias: the file is
 * hand-curated, a collision means the author is unsure whether the key is a
 * company or an alias (a data question, resolved with merge-companies.ts, not
 * by the seed), and a silent skip would leave a run that looks successful and
 * a mapping that never took effect — the same reasoning as
 * clear-non-company-employers.ts ("a typo must not pass as a no-op").
 *
 * Pure: never mutates its inputs; the result is sorted by alias key (then
 * company key), so it does not depend on input order.
 */
export interface SeedAliasRow {
  companyKey: string;
  aliases?: string[];
}

export interface AliasCollision {
  aliasKey: string;
  /** The company the seed file meant the alias to point at. */
  companyKey: string;
  reason: "live-company" | "created-by-this-run" | "would-shadow-existing-alias";
  /** Only for "would-shadow-existing-alias": the company the existing alias points at. */
  existingTarget?: string;
}

/** Every alias key in the file, for the one `company` lookup the script makes. */
export function allSeedAliasKeys(rows: readonly SeedAliasRow[]): string[] {
  return [...new Set(rows.flatMap((r) => r.aliases ?? []))].sort();
}

/** Keys of the rows for which the seed will insert a bare `company` (those with aliases): the lookup list for `company_alias`. */
export function seedCompanyKeys(rows: readonly SeedAliasRow[]): string[] {
  return [...new Set(rows.filter((r) => r.aliases?.length).map((r) => r.companyKey))].sort();
}

/**
 * `liveCompanyKeys`: which of `allSeedAliasKeys(rows)` and `seedCompanyKeys(rows)`
 * exist in `company`. `existingAliases`: alias_key -> company_key for the rows of
 * `company_alias` whose alias_key is in `seedCompanyKeys(rows)`. Both lookups are
 * bounded by the file and must happen before the first write.
 */
export function findAliasCollisions(
  rows: readonly SeedAliasRow[],
  liveCompanyKeys: ReadonlySet<string>,
  existingAliases: ReadonlyMap<string, string> = new Map(),
): AliasCollision[] {
  const createdByRun = new Set(rows.filter((r) => r.aliases?.length).map((r) => r.companyKey));
  const out: AliasCollision[] = [];
  for (const row of rows) {
    for (const aliasKey of new Set(row.aliases ?? [])) {
      if (liveCompanyKeys.has(aliasKey)) out.push({ aliasKey, companyKey: row.companyKey, reason: "live-company" });
      else if (createdByRun.has(aliasKey)) out.push({ aliasKey, companyKey: row.companyKey, reason: "created-by-this-run" });
    }
  }
  for (const key of seedCompanyKeys(rows)) {
    const existingTarget = existingAliases.get(key);
    if (existingTarget !== undefined && !liveCompanyKeys.has(key)) {
      out.push({ aliasKey: key, companyKey: key, reason: "would-shadow-existing-alias", existingTarget });
    }
  }
  return out.sort((a, b) => a.aliasKey.localeCompare(b.aliasKey) || a.companyKey.localeCompare(b.companyKey));
}
