/**
 * Read-only: everything in production that points at one `bd` row, so "can this BD be removed?" is answered
 * by the schema instead of by a remembered list of tables.
 *
 * The sweep itself lives in src/lib/bd/bdFootprint.ts, shared with the safety gate of
 * scripts/delete-unused-bd.ts — the question a human asks here and the one the writer enforces there must be
 * the same question.
 *
 * Usage: npx tsx --env-file=.env scripts/measure/bd-footprint.ts --email=<bd email>
 *
 * GUARD SCOPE (README rule 1): the guard covers the one connection it is set on, not the pool; every read
 * here is sequential and issues no write.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { blockingReferences, readBdFootprint } from "@/lib/bd/bdFootprint";

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

  const references = await readBdFootprint(db, target.id);
  console.log(`columns with a foreign key to bd(id): ${references.length}\n`);
  for (const r of references) {
    const mark = r.rows === 0 ? "          " : blockingReferences([r]).length > 0 ? "BLOQUEA   " : "referencia";
    console.log(`${mark}  ${r.table}.${r.column}: ${r.rows}  (on delete ${r.deleteRule.toLowerCase()})`);
  }

  const blocking = blockingReferences(references);
  const total = references.reduce((sum, r) => sum + r.rows, 0);
  console.log(`\nfilas que lo referencian: ${total} | de esas, bloqueantes: ${blocking.reduce((s, r) => s + r.rows, 0)}`);
  console.log(
    blocking.length === 0
      ? "se puede borrar: lo único que lo referencia son columnas 'on delete set null', que sobreviven con el puntero en null."
      : `NO se puede borrar: ${blocking.map((r) => `${r.table}.${r.column}`).join(", ")}`,
  );
  console.log("este conteo es sólo de claves foráneas: un id guardado dentro de un jsonb no aparece acá.");
  process.exit(0);
}

void main();
