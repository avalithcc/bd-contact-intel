/**
 * Backfill (or re-backfill) `contact.company_key` for every existing row,
 * using the same normalization applied at import time (see
 * src/lib/queries.ts#upsertContacts and
 * src/lib/companyCategories.ts#normalizeCompanyKey).
 *
 * Unlike `company_category` (a lookup against a DB table), `company_key` is
 * a pure function of `company` — no mapping table involved — so this script
 * just recomputes and writes it directly.
 *
 * Needed for rows imported before the `company_key` column existed
 * (one-time backfill after drizzle/0003_hiring_crossover.sql is applied).
 * Safe to re-run any time; it's idempotent.
 *
 * Pages through `contact` via keyset pagination on `id` (order by id, where
 * id > lastId, limit BATCH_SIZE) instead of loading the whole table into
 * memory, and applies each page as a single bulk UPDATE ... FROM
 * (VALUES ...) statement instead of one UPDATE per row (same pattern as
 * scripts/backfill-company-categories.ts).
 *
 * Usage (do NOT run automatically — this touches the real database):
 *   npx tsx scripts/backfill-company-keys.ts
 *
 * Requires DATABASE_URL to be set (see .env). Run AFTER
 * drizzle/0003_hiring_crossover.sql has been migrated.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { contact } from "../src/db/schema";
import { normalizeCompanyKey } from "../src/lib/companyCategories";

const BATCH_SIZE = 1000;

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

    const values = page.map((row) => {
      const trimmed = row.company?.trim();
      const key = trimmed ? normalizeCompanyKey(trimmed) : null;
      return sql`(${row.id}::uuid, ${key}::text)`;
    });
    await db.execute(sql`
      UPDATE contact AS c
      SET company_key = v.company_key
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, company_key)
      WHERE c.id = v.id
        AND c.company_key IS DISTINCT FROM v.company_key
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
