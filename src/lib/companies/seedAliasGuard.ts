/**
 * Preflight for scripts/seed-target-companies.ts's hand-written `aliases`.
 *
 * An alias key that is itself a company key is not an alias for anyone
 * (src/lib/companies/aliasRule.ts: the contact counts ignore such a row so the
 * company keeps its own people). The seed upserts aliases with
 * `on conflict (alias_key) do update set company_key = excluded.company_key`
 * and no look at `company`, so it is the one writer that can create that row
 * (the other, companyMerge/db.ts, deletes the dead company row first, in the
 * same transaction). Zero collisions exist in production (checked 2026-10-09).
 *
 * Two ways to collide, both reported:
 *  - "live-company": the alias key is already a `company.company_key`.
 *  - "created-by-this-run": the seed inserts a bare `company` row for every row
 *    that has aliases, so an alias equal to such a row's key (including its own
 *    row's key) would be a live company by the time the alias is written. A row
 *    WITHOUT aliases creates only a target_company row, so it does not count.
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
  reason: "live-company" | "created-by-this-run";
}

/** Every alias key in the file, for the one `company` lookup the script makes. */
export function allSeedAliasKeys(rows: readonly SeedAliasRow[]): string[] {
  return [...new Set(rows.flatMap((r) => r.aliases ?? []))].sort();
}

export function findAliasCollisions(rows: readonly SeedAliasRow[], liveCompanyKeys: ReadonlySet<string>): AliasCollision[] {
  const createdByRun = new Set(rows.filter((r) => r.aliases?.length).map((r) => r.companyKey));
  const out: AliasCollision[] = [];
  for (const row of rows) {
    for (const aliasKey of new Set(row.aliases ?? [])) {
      if (liveCompanyKeys.has(aliasKey)) out.push({ aliasKey, companyKey: row.companyKey, reason: "live-company" });
      else if (createdByRun.has(aliasKey)) out.push({ aliasKey, companyKey: row.companyKey, reason: "created-by-this-run" });
    }
  }
  return out.sort((a, b) => a.aliasKey.localeCompare(b.aliasKey) || a.companyKey.localeCompare(b.companyKey));
}
