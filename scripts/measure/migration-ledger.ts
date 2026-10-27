// Read-only: whether the latest migration really landed. drizzle-kit migrate prints "success" even when it skips an entry whose
// journal `when` is not above the ledger max, so check the ledger and the objects instead of trusting that message.
// Usage: npx tsx --env-file=.env scripts/measure/migration-ledger.ts [table.column ...]
// Prints the ledger row count, the newest ledger rows, and whether each named column exists. No row data is read.
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function main() {
  await db.transaction(async (tx) => {
    await measure(tx, process.argv.slice(2));
  });
  process.exit(0);
}

async function measure(tx: Tx, columns: string[]) {
  await tx.execute(sql`set transaction read only`);
  const guard = await tx.execute(sql`show transaction_read_only`);
  console.log(`transaction_read_only: ${(guard[0] as { transaction_read_only?: string }).transaction_read_only}`);

  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string }[] };
  const count = await tx.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
  console.log(`ledger rows: ${(count[0] as { n: number }).n} / journal entries in this checkout: ${journal.entries.length}`);

  const latest = await tx.execute(sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 2`);
  for (const row of latest as unknown as { created_at: string }[]) console.log(`ledger created_at: ${row.created_at}`);

  for (const spec of columns) {
    const [table, column] = spec.split(".");
    const found = await tx.execute(
      sql`select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = ${table} and column_name = ${column}`,
    );
    const col = found[0] as { data_type: string; is_nullable: string } | undefined;
    console.log(col ? `${spec}: present (${col.data_type}, nullable=${col.is_nullable})` : `${spec}: MISSING`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
