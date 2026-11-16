// Read-only: if board discovery is run over the never-probed backlog, probing the
// companies with the MOST contacts first, how many contacts does each slice reach?
// Coverage should be weighted by contacts, not by company: the point is how many
// outreach emails get a concrete hook, not how many rows get a board.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  const rows = (await db.execute(sql`
    select c.company_key, count(*)::int as contacts
    from person c
    left join company_probe cp on cp.company_key = c.company_key
    left join target_company t on t.company_key = c.company_key
    where c.merged_into_id is null and c.company_key is not null
      and cp.company_key is null and t.company_key is null
    group by c.company_key
    order by contacts desc
  `)) as unknown as Array<{ company_key: string; contacts: number }>;

  const totalContacts = rows.reduce((s, r) => s + r.contacts, 0);
  console.log(`never-probed companies: ${rows.length}, contacts at them: ${totalContacts}`);
  console.log("\nprobing the densest companies first:");
  console.log("  companies   contacts reached   % of the backlog's contacts   expected boards (13.3%)");
  for (const n of [100, 250, 500, 1000, 2000, 5000, rows.length]) {
    const slice = rows.slice(0, n);
    const reached = slice.reduce((s, r) => s + r.contacts, 0);
    const pct = ((reached / totalContacts) * 100).toFixed(1);
    console.log(`  ${String(n).padStart(9)}   ${String(reached).padStart(16)}   ${pct.padStart(27)}   ${String(Math.round(n * 0.133)).padStart(22)}`);
  }
  process.exit(0);
}
void main();
