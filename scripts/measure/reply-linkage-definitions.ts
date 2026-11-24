// Read-only. Prices the candidate definitions of "a reply to an email WE sent", so the choice is
// made on numbers instead of taste. In-Reply-To is parsed at sync time but never stored
// (email_message has rfc_message_id + rfc_references only), so the header test uses References.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  // Can the header test even run? An empty References column makes it silently strict.
  const coverage = await db.execute(sql`
    select direction,
           count(*)::int as rows,
           count(rfc_message_id)::int as has_message_id,
           count(rfc_references)::int as has_references
    from email_message group by direction order by 1
  `);

  const defs = await db.execute(sql`
    with reply as (
      select a.id as activity_id, a.person_id, m.id as msg_id, m.bd_id,
             m.gmail_thread_id, m.sent_at, m.rfc_references
      from activity a
      join email_message m
        on m.gmail_message_id = a.metadata->>'gmailMessageId' and m.direction = 'inbound'
      where a.type = 'reply_received' and a.deleted_at is null
    ),
    scored as (
      select reply.*,
        exists (
          select 1 from email_message o
          where o.direction = 'outbound' and o.rfc_message_id is not null
            and reply.rfc_references is not null
            and position(o.rfc_message_id in reply.rfc_references) > 0
        ) as header_linked,
        exists (
          select 1 from email_message o
          where o.direction = 'outbound'
            and o.gmail_thread_id = reply.gmail_thread_id
            and o.sent_at <= reply.sent_at
        ) as thread_linked
      from reply
    )
    select
      count(*)::int                                            as hoy_cuenta,
      count(*) filter (where header_linked)::int               as def_a_header,
      count(*) filter (where thread_linked)::int               as def_b_hilo,
      count(*) filter (where header_linked and not thread_linked)::int as solo_header,
      count(*) filter (where thread_linked and not header_linked)::int as solo_hilo,
      count(distinct person_id)::int                           as personas_hoy,
      count(distinct person_id) filter (where thread_linked)::int as personas_def_b,
      count(distinct gmail_thread_id) filter (where thread_linked)::int as hilos_def_b
    from scored
  `);

  // Per BD under each definition, last 90 days, next to what the report prints today.
  const perBd = await db.execute(sql`
    with reply as (
      select a.actor_bd_id, a.person_id, m.gmail_thread_id, m.sent_at
      from activity a
      join email_message m
        on m.gmail_message_id = a.metadata->>'gmailMessageId' and m.direction = 'inbound'
      where a.type = 'reply_received' and a.deleted_at is null
        and a.created_at >= now() - interval '90 days'
    )
    select b.name as bd,
      count(*)::int as hoy,
      count(*) filter (where exists (
        select 1 from email_message o
        where o.direction = 'outbound' and o.gmail_thread_id = reply.gmail_thread_id
          and o.sent_at <= reply.sent_at
      ))::int as atadas_a_lo_enviado,
      count(distinct reply.person_id) filter (where exists (
        select 1 from email_message o
        where o.direction = 'outbound' and o.gmail_thread_id = reply.gmail_thread_id
          and o.sent_at <= reply.sent_at
      ))::int as personas_que_contestaron
    from reply join bd b on b.id = reply.actor_bd_id
    group by b.name order by 2 desc
  `);

  console.log(JSON.stringify({ coverage, defs, perBd }, null, 2));
  process.exit(0);
}

void main();
