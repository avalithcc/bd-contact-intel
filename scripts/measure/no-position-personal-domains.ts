// Read-only. The Lusha starter plan REFUSES a lookup on a personal email address ("Private email
// address is not allowed for account type: starter") - 7 of the 25-contact sample died that way.
// So the real ceiling of a Lusha backfill is bounded by how many of the 107 sit on a free domain,
// and that is free to measure.
import { sql } from "drizzle-orm";
import { db } from "@/db";

const FREE = ["gmail.com","hotmail.com","hotmail.com.ar","outlook.com","outlook.es","yahoo.com","yahoo.com.ar",
  "live.com","icloud.com","me.com","aol.com","protonmail.com","proton.me","msn.com","ymail.com","gmx.com","zoho.com"];

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const freeList = sql.join(FREE.map((d) => sql`${d}`), sql`, `);
  const rows = await db.execute(sql`
    with pool as (
      select person.id, lower(split_part(person.email, '@', 2)) as domain,
             exists (
               select 1 from activity a
               join email_message inb
                 on inb.bd_id = a.actor_bd_id
                and inb.gmail_message_id = a.metadata->>'gmailMessageId'
                and inb.direction = 'inbound'
               where a.type = 'reply_received' and a.deleted_at is null and a.person_id = person.id
                 and (
                   exists (select 1 from email_message o where o.direction='outbound'
                            and o.bd_id = inb.bd_id and o.gmail_thread_id = inb.gmail_thread_id
                            and o.sent_at <= inb.sent_at)
                   or (inb.rfc_references is not null and exists (
                        select 1 from email_message o where o.direction='outbound'
                          and o.bd_id = inb.bd_id and o.rfc_message_id is not null and o.rfc_message_id <> ''
                          and position(o.rfc_message_id in inb.rfc_references) > 0))
                 )
             ) as contesto_lo_nuestro
      from person
      where person.role_group = 'no_position' and person.email is not null
        and exists (select 1 from activity a
                    where a.type = 'reply_received' and a.deleted_at is null and a.person_id = person.id)
    )
    select
      count(*)::int as total,
      count(*) filter (where domain in (${freeList}))::int as dominio_personal,
      count(*) filter (where domain not in (${freeList}))::int as dominio_corporativo,
      count(*) filter (where contesto_lo_nuestro)::int as contestaron,
      count(*) filter (where contesto_lo_nuestro and domain not in (${freeList}))::int as contestaron_y_consultables
    from pool
  `);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
void main();
