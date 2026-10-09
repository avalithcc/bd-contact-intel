/**
 * Seed (or re-seed) the `target_company` table — companies whose public job
 * board is polled for hiring signals — from a JSON file of the shape:
 *
 *   [
 *     {
 *       "companyKey": "<normalized key, see src/lib/companyCategories.ts#normalizeCompanyKey>",
 *       "displayName": "Acme Corp",
 *       "ats": "lever",
 *       "config": { "slug": "acme" },
 *       "countryFilter": "AR",
 *       "aliases": ["acme-corp-sa", "acme-argentina"]
 *     },
 *     ...
 *   ]
 *
 * `countryFilter` is optional — omit it or set it to null to track postings
 * in any location. `aliases` is optional — a list of normalized company
 * keys (see src/lib/companyCategories.ts#normalizeCompanyKey) that should
 * also resolve to this target company for the contacts<->hiring crossover
 * (e.g. a legal entity name a contact's LinkedIn company normalizes to,
 * distinct from the brand name used as `companyKey`). The file path is a
 * CLI argument, never hardcoded, so no target-company list needs to live in
 * this (public) repository.
 *
 * Idempotent: safe to re-run after editing the source file. Target
 * companies upsert by primary key (`company_key`); aliases upsert by
 * primary key (`alias_key`) and are only ever added or repointed, never
 * removed — deleting an alias from the source file does NOT delete it from
 * the database (remove it manually if that's ever needed).
 *
 * An alias requires a `company` row: `company_alias.company_key` is a foreign
 * key to `company` (migration 0039; it used to point at `target_company`, which
 * could not hold an alias to a plain CRM company). So before writing a row's
 * aliases this inserts a bare `company` row (company_key + display_name only,
 * the same shape src/lib/hubspot/importQueries.ts creates) with ON CONFLICT DO
 * NOTHING: an existing company, and everything a BD has set on it, is untouched.
 *
 * REFUSES a colliding alias (it does not skip it): an alias key that is already
 * a `company` key, or that this run creates as one, is not an alias for anyone
 * (src/lib/companies/aliasRule.ts), so the contact counts would ignore it. The
 * whole file is checked BEFORE the first write; on any collision it prints each
 * one and exits 1 with nothing written (a typo must not pass as a no-op, same
 * discipline as clear-non-company-employers.ts). Resolve it in the source file,
 * or merge the two companies with merge-companies.ts. This script has no dry
 * run, so the check is unconditional.
 *
 * Usage (do NOT run automatically — this touches the real database):
 *   npx tsx scripts/seed-target-companies.ts /path/to/target_companies.json
 *
 * Requires DATABASE_URL to be set (see .env).
 */
import fs from "node:fs";
import { inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { company, companyAlias, targetCompany } from "../src/db/schema";
import { allSeedAliasKeys, findAliasCollisions } from "../src/lib/companies/seedAliasGuard";

interface SeedRow {
  companyKey: string;
  displayName: string;
  ats: string;
  config: Record<string, unknown>;
  countryFilter?: string | null;
  aliases?: string[];
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Usage: npx tsx scripts/seed-target-companies.ts <path-to-target_companies.json>",
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const rows: SeedRow[] = JSON.parse(raw);

  const aliasKeys = allSeedAliasKeys(rows);
  const live = aliasKeys.length
    ? await db.select({ key: company.companyKey }).from(company).where(inArray(company.companyKey, aliasKeys))
    : [];
  const collisions = findAliasCollisions(rows, new Set(live.map((r) => r.key)));
  if (collisions.length) {
    console.error(`Refusing to seed: ${collisions.length} alias(es) are company keys, so they would be ignored. Nothing was written.`);
    for (const c of collisions) {
      const why = c.reason === "live-company" ? "is already a company" : "is created as a company by this run";
      console.error(`  alias "${c.aliasKey}" (for ${c.companyKey}) ${why}`);
    }
    process.exit(1);
  }

  console.log(`Seeding ${rows.length} target companies from ${filePath}...`);

  for (const row of rows) {
    await db
      .insert(targetCompany)
      .values({
        companyKey: row.companyKey,
        displayName: row.displayName,
        ats: row.ats,
        config: row.config,
        countryFilter: row.countryFilter ?? null,
      })
      .onConflictDoUpdate({
        target: targetCompany.companyKey,
        set: {
          displayName: sql`excluded.display_name`,
          ats: sql`excluded.ats`,
          config: sql`excluded.config`,
          countryFilter: sql`excluded.country_filter`,
        },
      });
    console.log(`  upserted ${row.companyKey}`);

    if (row.aliases?.length) {
      await db
        .insert(company)
        .values({ companyKey: row.companyKey, displayName: row.displayName })
        .onConflictDoNothing({ target: company.companyKey });
      await db
        .insert(companyAlias)
        .values(row.aliases.map((aliasKey) => ({ aliasKey, companyKey: row.companyKey })))
        .onConflictDoUpdate({
          target: companyAlias.aliasKey,
          set: { companyKey: sql`excluded.company_key` },
        });
      console.log(`    upserted ${row.aliases.length} alias(es) for ${row.companyKey}`);
    }
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
