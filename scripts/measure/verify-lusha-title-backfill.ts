// Read-only verification of the 2026-11-24 Lusha job-title backfill, measured independently of the
// script that wrote it: count the history rows it left, the audit row, and what actually moved in
// the population the report reads.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  const history = await db.execute(sql`
    select property, count(*)::int as rows,
           count(*) filter (where old_value is null or btrim(old_value) = '')::int as old_vacio
    from person_property_history
    where source = 'lusha_title_backfill_2026-11-24'
    group by property order by 1
  `);

  const audit = await db.execute(sql`
    select action, count(*)::int as rows, max(at)::text as last_at
    from audit_log where action = 'migration_backfill_lusha_job_titles'
    group by action
  `);

  // The population the report reads: everyone who ever produced a reply.
  const population = await db.execute(sql`
    select coalesce(person.role_group, '(null)') as role_group, count(distinct person.id)::int as personas
    from activity join person on person.id = activity.person_id
    where activity.type = 'reply_received' and activity.deleted_at is null
    group by 1 order by 2 desc
  `);

  const stillBlank = await db.execute(sql`
    select count(*)::int as sin_titulo
    from person
    where role_group = 'no_position'
      and exists (select 1 from activity a
                  where a.type = 'reply_received' and a.deleted_at is null and a.person_id = person.id)
  `);

  console.log(JSON.stringify({ history, audit, stillBlank, population }, null, 2));
  process.exit(0);
}
void main();
