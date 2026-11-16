// Read-only: does ATS board discovery actually work for LATAM companies?
// The owner's eight prospects are all LATAM and the four that were probed all missed.
// If the hit rate collapses outside the US/Europe, sweeping the backlog will not help
// the contacts he actually emails, and the lever is somewhere else entirely.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const rows = await db.execute(sql`
    select coalesce(nullif(trim(c.country), ''), '(unknown)') as country,
           count(*)::int as probed,
           count(*) filter (where cp.hit)::int as hits,
           round(100.0 * count(*) filter (where cp.hit) / nullif(count(*), 0), 1) as hit_pct
    from company_probe cp
    join company c on c.company_key = cp.company_key
    group by 1
    having count(*) >= 20
    order by probed desc
  `);
  console.log("probed companies by country (>=20 probed):");
  for (const r of rows as unknown as Array<{ country: string; probed: number; hits: number; hit_pct: string }>) {
    console.log(`  ${r.country.padEnd(18)} probed=${String(r.probed).padStart(5)}  hits=${String(r.hits).padStart(4)}  ${String(r.hit_pct).padStart(5)}%`);
  }
  process.exit(0);
}
void main();
