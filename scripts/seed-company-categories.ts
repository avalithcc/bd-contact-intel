/**
 * Seed (or re-seed) the shared `company_category` mapping table from a
 * private, out-of-repo JSON file of the shape:
 *
 *   { "<normalizedKey>": "<categoryKey>", ... }
 *
 * The mapping is derived from a BD's private LinkedIn network and MUST
 * NEVER be committed to this (public) repository — that is why this script
 * takes the file path as a CLI argument instead of a hardcoded path, and why
 * no copy of the data lives anywhere under this repo.
 *
 * The keys in the JSON file are expected to already be normalized the same
 * way as src/lib/companyCategories.ts#normalizeCompanyKey (this script does
 * NOT re-normalize them — it trusts the input file's keys as-is).
 *
 * Idempotent: safe to re-run after editing the source mapping, upserts by
 * primary key (`key`).
 *
 * Usage (do NOT run automatically — this touches the real database):
 *   npx tsx scripts/seed-company-categories.ts /path/to/company_categories.json
 *
 * Requires DATABASE_URL to be set (see .env).
 */
import fs from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { companyCategory } from "../src/db/schema";

const BATCH_SIZE = 500;

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Usage: npx tsx scripts/seed-company-categories.ts <path-to-company_categories.json>",
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const mapping: Record<string, string> = JSON.parse(raw);
  const entries = Object.entries(mapping);

  console.log(`Seeding ${entries.length} company categories from ${filePath}...`);

  let done = 0;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE).map(([key, category]) => ({
      key,
      category,
    }));
    await db
      .insert(companyCategory)
      .values(batch)
      .onConflictDoUpdate({
        target: companyCategory.key,
        set: {
          category: sql`excluded.category`,
          updatedAt: sql`now()`,
        },
      });
    done += batch.length;
    console.log(`  ${done}/${entries.length}`);
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
