// Read-only: locate a person by name fragment and print what an edit would change.
// Usage: npx tsx --env-file=.env scripts/measure/find-person.ts --name=Tormo
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--name="));
  if (!arg) throw new Error("Usage: --name=<fragment>");
  const needle = `%${arg.slice("--name=".length).toLowerCase()}%`;

  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  console.log(`read_only: ${JSON.stringify(guard[0] ?? guard)}\n`);

  const rows = await db.execute(sql`
    select p.id::text, p.first_name, p.last_name, p.job_title, p.role_group,
           p.company, p.merged_into_id::text as merged_into, b.name as owner
    from person p
    left join bd b on b.id = p.owner_bd_id
    where lower(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) like ${needle}
    order by p.merged_into_id nulls first
  `);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

void main();
