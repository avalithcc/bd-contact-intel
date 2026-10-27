/**
 * Read-only: the id and name of every bd row, so an owner-run script that
 * needs `--actor=<bd id>` (merge-duplicates.ts, merge-one-duplicate.ts,
 * merge-companies.ts) can be given the right uuid instead of a guessed one.
 *
 * GUARD SCOPE (README rule 1): the guard covers the one connection it is set
 * on, not the whole pool; every read here is sequential and issues no write.
 */
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd } from "@/db/schema";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  console.log(`read_only: ${JSON.stringify(guard[0] ?? guard)} (this connection)\n`);

  const rows = await db.select({ id: bd.id, name: bd.name, role: bd.role }).from(bd).orderBy(asc(bd.name));
  for (const r of rows) console.log(`${r.id}  ${r.role ?? "-"}  ${r.name}`);
  process.exit(0);
}

void main();
