/**
 * Read-only: everything in production that points at one `bd` row, so "can this BD be removed?" is answered
 * by the schema instead of by a remembered list of tables.
 *
 * Every column with a foreign key to `bd(id)` is read out of information_schema and counted, so a table added
 * after this script was written is included automatically. That is the whole point: the previous answer to
 * this question (openspec/BACKLOG.md, 2026-10-13) checked six tables by hand and could not have known about
 * `sequence`, `follow_up_queue_item` or `email_account`.
 *
 * Usage: npx tsx --env-file=.env scripts/measure/bd-footprint.ts --email=<bd email>
 *
 * GUARD SCOPE (README rule 1): the guard covers the one connection it is set on, not the pool; every read
 * here is sequential and issues no write.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

type FkColumn = { table_name: string; column_name: string };

async function main() {
  const emailArg = process.argv.slice(2).find((a) => a.startsWith("--email="));
  if (!emailArg) throw new Error("Usage: --email=<bd email>");
  const email = emailArg.slice("--email=".length);

  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  console.log(`read_only: ${JSON.stringify(guard[0] ?? guard)} (this connection)\n`);

  const bdRows = await db.execute<{ id: string; name: string; role: string | null }>(
    sql`select id::text as id, name, role from bd where lower(email) = lower(${email})`,
  );
  const target = [...bdRows][0];
  if (!target) {
    console.log(`no bd row with email ${email}`);
    process.exit(0);
  }
  console.log(`${target.name} <${email}> id=${target.id} role=${target.role ?? "-"}\n`);

  // Every FK column that references bd(id), straight from the catalog.
  const fkRows = await db.execute<FkColumn>(sql`
    select tc.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and ccu.table_name = 'bd'
      and ccu.column_name = 'id'
    order by tc.table_name, kcu.column_name
  `);
  const columns = [...fkRows];
  console.log(`columns with a foreign key to bd(id): ${columns.length}\n`);

  let total = 0;
  for (const { table_name, column_name } of columns) {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.raw(`"${table_name}"`)} where ${sql.raw(`"${column_name}"`)} = ${target.id}::uuid`,
    );
    const n = Number(row?.n ?? 0);
    total += n;
    console.log(`${n > 0 ? "REFERENCIA" : "          "}  ${table_name}.${column_name}: ${n}`);
  }

  // Both audit_log columns carry a real foreign key (actor_bd_id ON DELETE CASCADE, target_bd_id ON DELETE
  // SET NULL), so the catalog sweep above already counts them; there is nothing to check separately.
  console.log(`\ntotal de filas que lo referencian: ${total}`);
  console.log("recordá que este conteo es sólo de claves foráneas: un id guardado dentro de un jsonb no aparece acá.");
  process.exit(0);
}

void main();
