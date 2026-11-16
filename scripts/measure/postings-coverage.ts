// Read-only: why do the companies BDs actually email have no hiring data?
// messagePrompt.ts rule 4 and the subject rule both collapse to boilerplate without postings,
// so posting COVERAGE is the ceiling on how specific any outreach can be.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  const totals = await db.execute(sql`
    select
      (select count(*)::int from company) as companies,
      (select count(*)::int from target_company) as targets,
      (select count(distinct company_key)::int from job_posting) as with_postings,
      (select count(*)::int from job_posting) as postings
  `);
  console.log("totals:", JSON.stringify(totals[0]));

  console.log("\ntarget companies by ATS:");
  const byAts = await db.execute(sql`select ats, count(*)::int as n from target_company group by ats order by n desc`);
  for (const r of byAts as unknown as Array<{ ats: string; n: number }>) console.log(`  ${String(r.n).padStart(4)}  ${r.ats}`);

  // The population that matters: companies where this BD team actually has contacts.
  console.log("\ncompanies with contacts, by whether they have postings:");
  const coverage = await db.execute(sql`
    select
      count(*)::int as companies_with_contacts,
      count(*) filter (where t.company_key is not null)::int as are_targets,
      count(*) filter (where jp.company_key is not null)::int as have_postings
    from (select distinct company_key from person where company_key is not null and merged_into_id is null) c
    left join target_company t on t.company_key = c.company_key
    left join (select distinct company_key from job_posting) jp on jp.company_key = c.company_key
  `);
  console.log(JSON.stringify(coverage[0], null, 2));

  // Weighted by contacts, not by company: a company with 300 contacts matters 300x more.
  console.log("\ncontacts whose company has postings:");
  const byContact = await db.execute(sql`
    select
      count(*)::int as contacts,
      count(*) filter (where jp.company_key is not null)::int as with_postings
    from person p
    left join (select distinct company_key from job_posting) jp on jp.company_key = p.company_key
    where p.merged_into_id is null and p.company_key is not null
  `);
  console.log(JSON.stringify(byContact[0], null, 2));

  console.log("\nlast sync runs:");
  const runs = await db.execute(sql`
    select status, count(*)::int as n, max(finished_at) as last
    from sync_run group by status order by n desc
  `);
  for (const r of runs as unknown as Array<{ status: string; n: number; last: Date }>) {
    console.log(`  ${String(r.n).padStart(5)}  ${r.status.padEnd(6)} last=${r.last?.toISOString?.() ?? r.last}`);
  }

  process.exit(0);
}
void main();
