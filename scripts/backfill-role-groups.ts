/**
 * Backfill (or re-backfill) `contact.role_group` for every existing row,
 * using the same classifier used at import time (src/lib/roleGroups.ts).
 *
 * Needed for:
 *  - Rows imported before the `role_group` column existed (one-time backfill).
 *  - Reclassifying everything after the classification rules change
 *    (RULES in src/lib/roleGroups.ts are expected to evolve) — just re-run
 *    this script, it's idempotent and safe to run repeatedly.
 *
 * Pages through `contact` via keyset pagination on `id` (order by id, where
 * id > lastId, limit BATCH_SIZE) instead of loading the whole table into
 * memory, and applies each page as a single bulk UPDATE ... FROM (VALUES ...)
 * statement instead of one UPDATE per row.
 *
 * Usage (do NOT run automatically — this touches the real database):
 *   npx tsx scripts/backfill-role-groups.ts
 *
 * Requires DATABASE_URL to be set (see .env).
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { contact } from "../src/db/schema";
import { classifyPosition } from "../src/lib/roleGroups";

const BATCH_SIZE = 1000;

async function main() {
  let lastId: string | null = null;
  let updated = 0;

  for (;;) {
    const page: { id: string; position: string | null }[] = await db
      .select({ id: contact.id, position: contact.position })
      .from(contact)
      .where(lastId === null ? undefined : sql`${contact.id} > ${lastId}`)
      .orderBy(contact.id)
      .limit(BATCH_SIZE);

    if (!page.length) break;

    const values = page.map(
      (row) => sql`(${row.id}::uuid, ${classifyPosition(row.position)}::text)`,
    );
    await db.execute(sql`
      UPDATE contact AS c
      SET role_group = v.role_group
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, role_group)
      WHERE c.id = v.id
        AND c.role_group IS DISTINCT FROM v.role_group
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
