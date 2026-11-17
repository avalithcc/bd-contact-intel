// Read-only: how much of the discovery backlog is actually REACHABLE?
// getCandidateCompanies excludes a company whose every contact row is independent/other/
// unclassified/software_services. Most never-probed companies are unclassified, so the
// backlog that discovery can act on is far smaller than the raw never-probed count.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const r = await db.execute(sql`
    with eligible as (
      select c.company_key,
             (min(cp.last_probed_at) is null) as never_probed,
             min(coalesce(c.company_category, 'unclassified')) as best_category,
             count(*)::int as contacts
      from contact c
      left join company_probe cp on cp.company_key = c.company_key
      where c.company_key is not null and c.company_key != ''
        and not exists (select 1 from target_company tc where tc.company_key = c.company_key)
      group by c.company_key
    )
    select
      count(*) filter (where never_probed)::int as never_probed,
      count(*) filter (where never_probed and best_category not in ('independent','other','unclassified','software_services'))::int as never_probed_reachable,
      sum(contacts) filter (where never_probed and best_category not in ('independent','other','unclassified','software_services'))::int as contacts_reachable
    from eligible
  `);
  console.log(JSON.stringify(r[0], null, 2));

  console.log("\nALL eligible companies by best category (probed or not):");
  const byCat = await db.execute(sql`
    select min(coalesce(c.company_category,'unclassified')) as best_category, count(*)::int as n
    from contact c
    left join company_probe cp on cp.company_key = c.company_key
    where c.company_key is not null and c.company_key != ''
      and not exists (select 1 from target_company tc where tc.company_key = c.company_key)
    group by c.company_key
  `);
  const tally = new Map<string, number>();
  for (const row of byCat as unknown as Array<{ best_category: string }>) {
    tally.set(row.best_category, (tally.get(row.best_category) ?? 0) + 1);
  }
  for (const [cat, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${cat}`);
  process.exit(0);
}
void main();
