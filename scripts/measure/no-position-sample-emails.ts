// Read-only. Prints 25 contact emails from the no-position population THAT ANSWERED OUR MAIL, to
// test (with the owner's explicit approval, 2026-11-24) whether Lusha returns a job title without a
// paid reveal. Only the sample's own addresses are printed - nothing about the account's owner.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const rows = await db.execute<{ email: string }>(sql`
    select person.email
    from person
    where person.role_group = 'no_position' and person.email is not null
      and exists (
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
      )
    order by person.id
    limit 25
  `);
  console.log(JSON.stringify(rows.map((r) => r.email)));
  process.exit(0);
}
void main();
