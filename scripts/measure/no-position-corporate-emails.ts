// Read-only. The corporate-domain subset of the 107 no-position repliers: the only ones the Lusha
// starter plan will answer for. Prints JSON lines of {id, email, first_name, last_name, company} so
// the lookup can be batched and the result matched back by id, never by email alone.
import { sql } from "drizzle-orm";
import { db } from "@/db";

const FREE = ["gmail.com","hotmail.com","hotmail.com.ar","outlook.com","outlook.es","yahoo.com","yahoo.com.ar",
  "live.com","icloud.com","me.com","aol.com","protonmail.com","proton.me","msn.com","ymail.com","gmx.com","zoho.com"];

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const freeList = sql.join(FREE.map((d) => sql`${d}`), sql`, `);
  const rows = await db.execute<{ id: string; email: string; first_name: string | null; last_name: string | null; company: string | null }>(sql`
    select person.id, person.email, person.first_name, person.last_name, person.company
    from person
    where person.role_group = 'no_position'
      and person.email is not null
      and (person.job_title is null or btrim(person.job_title) = '')
      and lower(split_part(person.email, '@', 2)) not in (${freeList})
      and exists (select 1 from activity a
                  where a.type = 'reply_received' and a.deleted_at is null and a.person_id = person.id)
    order by person.email
  `);
  console.log(JSON.stringify(rows, null, 1));
  process.exit(0);
}
void main();
