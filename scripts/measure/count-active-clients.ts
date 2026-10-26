// Read-only: how many of today's follow-up rows belong to active-client
// companies, i.e. how many disappear from Seguimientos when PR #424 deploys.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const rows = await db.execute(sql`
    select b.name as bd,
           count(*) filter (where c.client_status = 'active')::int as se_van,
           count(*)::int as total_hoy
    from follow_up_queue_item q
    join bd b on b.id = q.bd_id
    join person p on p.id = q.person_id
    left join company c on c.company_key = p.company_key
    where q.queue_date = (now() at time zone 'America/Argentina/Buenos_Aires')::date
    group by b.name
    order by b.name
  `);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

void main();
