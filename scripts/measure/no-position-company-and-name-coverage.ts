// Read-only. Guard 6 of the title backfill accepts a company match by DOMAIN or by NAME, comparing
// Lusha's company name against `person.company`. The dry run sent 8 records to needs_review for a
// company mismatch, including two that are plainly the same company (an email at fluxit.com.ar vs
// Lusha's fluxitsoft.com, same company name). If `person.company` is empty the name path can never
// fire and guard 6 silently collapses to domain-only. This counts that.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const rows = await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where company is null or btrim(company) = '')::int as sin_company,
      count(*) filter (where company_key is null or btrim(company_key) = '')::int as sin_company_key,
      count(*) filter (where (first_name is null or btrim(first_name) = '')
                         and (last_name is null or btrim(last_name) = ''))::int as sin_nombre
    from person
    where role_group = 'no_position'
      and exists (select 1 from activity a
                  where a.type = 'reply_received' and a.deleted_at is null and a.person_id = person.id)
  `);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
void main();
