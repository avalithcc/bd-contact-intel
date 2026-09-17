/**
 * Backfill (or re-backfill) `job_posting.is_miami` for every existing row,
 * using the same classifier applied at sync time (see
 * src/lib/hiring/sync.ts and src/lib/hiring/markets.ts#isMiamiArea).
 *
 * `is_miami` is a pure function of `location` — no lookup table involved —
 * so this script just recomputes and writes it directly, same pattern as
 * scripts/backfill-posting-markets.ts.
 *
 * Needed for rows synced before the `is_miami` column existed (one-time
 * backfill after drizzle/0007_job_posting_miami.sql is applied) — new rows
 * inserted after that migration already get it set correctly by sync.ts,
 * this script only reclassifies rows that already exist in the table.
 * Safe to re-run any time; it's idempotent.
 *
 * Pages through `job_posting` via keyset pagination on `id` (order by id,
 * where id > lastId, limit BATCH_SIZE) instead of loading the whole table
 * into memory, and applies each page as a single bulk UPDATE ... FROM
 * (VALUES ...) statement instead of one UPDATE per row.
 *
 * Usage (do NOT run automatically — this touches the real database):
 *   npx tsx scripts/backfill-posting-miami.ts
 *
 * Requires DATABASE_URL to be set (see .env). Run AFTER
 * drizzle/0007_job_posting_miami.sql has been migrated.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { jobPosting } from "../src/db/schema";
import { isMiamiArea } from "../src/lib/hiring/markets";

const BATCH_SIZE = 1000;

async function main() {
  let lastId: string | null = null;
  let updated = 0;

  for (;;) {
    const page: { id: string; location: string | null }[] = await db
      .select({ id: jobPosting.id, location: jobPosting.location })
      .from(jobPosting)
      .where(lastId === null ? undefined : sql`${jobPosting.id} > ${lastId}`)
      .orderBy(jobPosting.id)
      .limit(BATCH_SIZE);

    if (!page.length) break;

    const values = page.map((row) => {
      const isMiami = isMiamiArea(row.location);
      return sql`(${row.id}::uuid, ${isMiami}::boolean)`;
    });
    await db.execute(sql`
      UPDATE job_posting AS jp
      SET is_miami = v.is_miami
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, is_miami)
      WHERE jp.id = v.id
        AND jp.is_miami IS DISTINCT FROM v.is_miami
    `);

    updated += page.length;
    lastId = page[page.length - 1].id;
    console.log(`  ${updated} processed (last id ${lastId})`);
  }

  console.log(`Done. ${updated} job postings processed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
