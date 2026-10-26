// merge_event has no candidate_id column (id, survivor_id, merged_id, reason,
// actor_bd_id), so a merge is not joinable back to its candidate here.
// Read-only: the status of every duplicate_candidate, and the detail of the
// one the owner left unresolved (Ezequiel Locurscio, id prefix f4617bcf).
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  console.log(`read_only: ${JSON.stringify(guard[0] ?? guard)}\n`);

  const byStatus = await db.execute(sql`
    select status, count(*)::int as n from duplicate_candidate group by status order by status
  `);
  console.log(`por estado: ${JSON.stringify(byStatus)}`);

  const one = await db.execute(sql`
    select dc.id::text, dc.status, dc.reason, dc.decided_by_bd_id::text,
           b.name as decided_by
    from duplicate_candidate dc
    left join bd b on b.id = dc.decided_by_bd_id
    where dc.id::text like 'f4617bcf%'
  `);
  console.log(`\nEzequiel: ${JSON.stringify(one, null, 2)}`);
  process.exit(0);
}

void main();
