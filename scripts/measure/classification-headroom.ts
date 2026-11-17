// Read-only: how much of the unclassified company backlog could be classified from signals the
// database ALREADY holds, rather than by hand?
//
// `company_category` is a lookup keyed by normalized company name (src/lib/companyCategories.ts),
// and 8,804 companies sit outside it as `unclassified`. Being unclassified excludes them from ATS
// board discovery, which is why their contacts get outreach with no hiring hook.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  // The population: companies whose every contact row is unclassified/other/independent, i.e. the
  // ones the discovery gate rejects. software_services is excluded on purpose (competitors), so it
  // is reported separately rather than counted as headroom.
  const base = sql`
    select c.company_key,
           count(*)::int as contacts,
           min(coalesce(c.company_category, 'unclassified')) as best_category
    from contact c
    where c.company_key is not null and c.company_key != ''
    group by c.company_key
    having min(coalesce(c.company_category, 'unclassified')) in ('unclassified', 'other', 'independent')
  `;

  const totals = await db.execute(sql`
    with blocked as (${base})
    select
      count(*)::int as blocked_companies,
      sum(contacts)::int as blocked_contacts,
      count(*) filter (where co.domain is not null and co.domain <> '')::int as have_domain,
      count(*) filter (where co.industry is not null and co.industry <> '')::int as have_company_industry,
      count(*) filter (where pi.person_industry is not null)::int as have_contact_industry,
      count(*) filter (where (co.domain is not null and co.domain <> '') or (co.industry is not null and co.industry <> '') or pi.person_industry is not null)::int as have_any_signal
    from blocked b
    left join company co on co.company_key = b.company_key
    left join lateral (
      select max(p.industry) as person_industry from person p
      where p.company_key = b.company_key and p.industry is not null and p.industry <> ''
    ) pi on true
  `);
  console.log("blocked by the discovery category gate:");
  console.log(JSON.stringify(totals[0], null, 2));

  console.log("\ntop contact-reported industries at those companies (the raw signal to map from):");
  const industries = await db.execute(sql`
    with blocked as (${base})
    select lower(trim(p.industry)) as industry, count(distinct p.company_key)::int as companies, count(*)::int as contacts
    from blocked b
    join person p on p.company_key = b.company_key
    where p.industry is not null and p.industry <> '' and p.merged_into_id is null
    group by 1
    order by companies desc
    limit 20
  `);
  for (const r of industries as unknown as Array<{ industry: string; companies: number; contacts: number }>) {
    console.log(`  ${String(r.companies).padStart(5)} companies  ${String(r.contacts).padStart(5)} contacts  ${r.industry}`);
  }

  process.exit(0);
}
void main();
