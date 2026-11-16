// Read-only: has ATS board discovery actually been run over the companies BDs email,
// and what did it find? Postings coverage is the ceiling on outreach specificity
// (only 2.5% of contacts work at a company with any hiring data), and discovery is
// the existing machine for raising it.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  const probe = await db.execute(sql`
    select count(*)::int as probed,
           count(*) filter (where hit)::int as hits,
           min(last_probed_at) as first_probe,
           max(last_probed_at) as last_probe
    from company_probe
  `);
  console.log("company_probe:", JSON.stringify(probe[0], null, 2));

  const runs = await db.execute(sql`
    select count(*)::int as runs, sum(companies_probed)::int as probed, sum(hits)::int as hits, max(finished_at) as last
    from discovery_run
  `);
  console.log("discovery_run:", JSON.stringify(runs[0], null, 2));

  const candidates = await db.execute(sql`select status, count(*)::int as n from board_candidate group by status order by n desc`);
  console.log("board_candidate by status:", JSON.stringify(candidates));

  // The gap that matters: companies where contacts live, never probed and not targets.
  const unprobed = await db.execute(sql`
    select count(*)::int as never_probed
    from (select distinct company_key from person where company_key is not null and merged_into_id is null) c
    left join company_probe cp on cp.company_key = c.company_key
    left join target_company t on t.company_key = c.company_key
    where cp.company_key is null and t.company_key is null
  `);
  console.log("companies with contacts never probed and not targets:", JSON.stringify(unprobed[0]));

  // Were the eight companies from the report ever probed?
  const eight = await db.execute(sql`
    select c.display_name, (cp.company_key is not null) as probed, cp.hit, (t.company_key is not null) as is_target
    from company c
    left join company_probe cp on cp.company_key = c.company_key
    left join target_company t on t.company_key = c.company_key
    where c.display_name in ('Cargamos','PasajeBus','Plataforma 10','Flybondi','Glovo','Nowports','Meru','ISTMO Center')
    order by c.display_name
  `);
  console.log("\nthe eight companies from the report:");
  for (const r of eight as unknown as Array<{ display_name: string; probed: boolean; hit: boolean | null; is_target: boolean }>) {
    console.log(`  ${r.display_name.padEnd(16)} probed=${r.probed}  hit=${r.hit}  target=${r.is_target}`);
  }

  process.exit(0);
}
void main();
