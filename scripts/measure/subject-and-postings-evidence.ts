// Read-only: do the companies the owner is actually emailing have the hiring data the prompt
// needs? messagePrompt.ts rule 4 ("If no posting data is given, skip this and speak generally")
// and the subject rule's own fallback both degrade to boilerplate without it, which would explain
// an abstract subject AND the generic US-timezone pitch in the same email.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  const perCompany = await db.execute(sql`
    select c.display_name,
           count(j.id)::int as postings,
           count(j.id) filter (where j.is_it)::int as it_postings
    from company c
    left join job_posting j on j.company_key = c.company_key
    where c.display_name in
      ('Cargamos','PasajeBus','Plataforma 10','Flybondi','Glovo','Nowports','Meru','ISTMO Center')
    group by c.display_name
    order by c.display_name
  `);
  console.log("postings for the companies in the screenshot:");
  for (const r of perCompany as unknown as Array<{ display_name: string; postings: number; it_postings: number }>) {
    console.log(`  ${r.display_name.padEnd(16)} postings=${r.postings}  it=${r.it_postings}`);
  }

  const subjects = await db.execute(sql`
    select subject from sequence_draft where subject is not null order by generated_at desc limit 25
  `);
  console.log("\nmost recent live subjects (length in brackets):");
  for (const r of subjects as unknown as Array<{ subject: string }>) {
    console.log(`  [${String(r.subject).length.toString().padStart(2)}] ${r.subject}`);
  }

  process.exit(0);
}
void main();
