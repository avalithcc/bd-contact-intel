/**
 * Backfill (or re-backfill) `contact.company_category` for every existing
 * row, using the same lookup table used at import time
 * (see src/lib/queries.ts#upsertContacts and src/lib/companyCategories.ts).
 *
 * Needed for:
 *  - Rows imported before the `company_category` column existed (one-time
 *    backfill).
 *  - Re-applying after the `company_category` mapping table is edited or
 *    re-seeded (scripts/seed-company-categories.ts) — just re-run this
 *    script, it's idempotent and safe to run repeatedly.
 *
 * Pages through `contact` via keyset pagination on `id` (order by id, where
 * id > lastId, limit BATCH_SIZE) instead of loading the whole table into
 * memory. Looks up normalized keys in one batched query per page (not one
 * per row), and applies each page as a single bulk UPDATE ... FROM
 * (VALUES ...) statement instead of one UPDATE per row.
 *
 * Usage (do NOT run automatically — this touches the real database):
 *   npx tsx scripts/backfill-company-categories.ts
 *
 * Requires DATABASE_URL to be set (see .env). Run AFTER
 * scripts/seed-company-categories.ts has populated the mapping table.
 */
import { inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { companyCategory, contact } from "../src/db/schema";
import { normalizeCompanyKey, type CompanyCategoryKey } from "../src/lib/companyCategories";

const BATCH_SIZE = 1000;

/** Same resolution rules as src/lib/queries.ts#resolveCompanyCategories. */
async function resolveCategories(
  companies: (string | null)[],
): Promise<Map<string | null, CompanyCategoryKey>> {
  const result = new Map<string | null, CompanyCategoryKey>();
  const keyToCompanies = new Map<string, Set<string | null>>();

  for (const company of companies) {
    if (result.has(company)) continue;
    const trimmed = company?.trim();
    if (!trimmed) {
      result.set(company, "no_company");
      continue;
    }
    const key = normalizeCompanyKey(trimmed);
    if (!key) {
      result.set(company, "unclassified");
      continue;
    }
    const set = keyToCompanies.get(key) ?? new Set();
    set.add(company);
    keyToCompanies.set(key, set);
  }

  const keys = [...keyToCompanies.keys()];
  if (keys.length) {
    const mapped = await db
      .select({ key: companyCategory.key, category: companyCategory.category })
      .from(companyCategory)
      .where(inArray(companyCategory.key, keys));
    const foundKeys = new Set<string>();
    for (const row of mapped) {
      foundKeys.add(row.key);
      for (const company of keyToCompanies.get(row.key) ?? []) {
        result.set(company, row.category as CompanyCategoryKey);
      }
    }
    for (const key of keys) {
      if (foundKeys.has(key)) continue;
      for (const company of keyToCompanies.get(key) ?? []) {
        result.set(company, "unclassified");
      }
    }
  }

  return result;
}

async function main() {
  let lastId: string | null = null;
  let updated = 0;

  for (;;) {
    const page: { id: string; company: string | null }[] = await db
      .select({ id: contact.id, company: contact.company })
      .from(contact)
      .where(lastId === null ? undefined : sql`${contact.id} > ${lastId}`)
      .orderBy(contact.id)
      .limit(BATCH_SIZE);

    if (!page.length) break;

    const categories = await resolveCategories(page.map((r) => r.company));
    const values = page.map((row) => {
      const category = categories.get(row.company) ?? "unclassified";
      return sql`(${row.id}::uuid, ${category}::text)`;
    });
    await db.execute(sql`
      UPDATE contact AS c
      SET company_category = v.company_category
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, company_category)
      WHERE c.id = v.id
        AND c.company_category IS DISTINCT FROM v.company_category
    `);

    updated += page.length;
    lastId = page[page.length - 1].id;
    console.log(`  ${updated} processed (last id ${lastId})`);
  }

  console.log(`Done. ${updated} contacts processed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
