// Read-only. Excluding a role group means joining `person`. An INNER join would silently drop every
// activity row that has no person (company- or lead-scoped), which is a different bug than the one
// being fixed. This counts how many rows are at risk per column of "Actividad por BD".
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const rows = await db.execute(sql`
    select activity.type,
           count(*)::int as rows,
           count(*) filter (where activity.person_id is null)::int as sin_person,
           count(*) filter (where activity.person_id is not null and person.id is null)::int as person_inexistente,
           count(*) filter (where person.role_group is null)::int as role_group_null
    from activity
    left join person on person.id = activity.person_id
    where activity.deleted_at is null
      and activity.type in ('note','call_attempt','call','whatsapp','whatsapp_no_channel','meeting_logged','email_sent','reply_received')
    group by activity.type order by 2 desc
  `);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
void main();
