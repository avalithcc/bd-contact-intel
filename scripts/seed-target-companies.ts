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
 * Usage (do NOT run automatically — this touches the real database):
 *   npx tsx scripts/seed-target-companies.ts /path/to/target_companies.json
 *
 * Requires DATABASE_URL to be set (see .env).
 */
import fs from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { companyAlias, targetCompany } from "../src/db/schema";

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
