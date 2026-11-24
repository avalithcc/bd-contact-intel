// Read-only. Answers two owner questions about "Actividad por BD" -> "Respuestas recibidas":
//   1. Are those replies answers to mail WE sent, or just any inbound from a known contact?
//   2. Are bounces / auto-replies being counted in that column?
// The column counts exactly `activity.type = 'reply_received'` grouped by actor_bd_id
// (src/lib/reports/queries.ts, rpt_activity_pivot). This script measures that same population.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  const byType = await db.execute(sql`
    select type, count(*)::int as rows,
           min(created_at)::date as first_row, max(created_at)::date as last_row
    from activity
    where type in ('email_sent','reply_received','auto_reply_received','email_bounced')
      and deleted_at is null
    group by type order by 2 desc
  `);

  // Does the counted reply have a machine-generated message behind it?
  const automatic = await db.execute(sql`
    select
      count(*)::int as replies_counted,
      count(m.id)::int as matched_to_email_message,
      count(*) filter (where m.is_automatic)::int as flagged_automatic,
      count(*) filter (where m.id is null)::int as no_email_message_row
    from activity a
    left join email_message m
      on m.gmail_message_id = a.metadata->>'gmailMessageId'
     and m.direction = 'inbound'
    where a.type = 'reply_received' and a.deleted_at is null
  `);

  // Is the reply an answer to something we sent? Two independent tests:
  //  thread_has_our_outbound  - same gmail_thread_id carries an OUTBOUND message sent before it
  //  person_was_emailed_first - we logged an email_sent to that person before the reply
  const linked = await db.execute(sql`
    with reply as (
      select a.id, a.person_id, a.created_at,
             m.id as msg_id, m.gmail_thread_id, m.sent_at, m.bd_id
      from activity a
      left join email_message m
        on m.gmail_message_id = a.metadata->>'gmailMessageId' and m.direction = 'inbound'
      where a.type = 'reply_received' and a.deleted_at is null
    )
    select
      count(*)::int as replies_counted,
      count(*) filter (where exists (
        select 1 from email_message o
        where o.gmail_thread_id = reply.gmail_thread_id
          and o.direction = 'outbound'
          and o.sent_at <= reply.sent_at
      ))::int as thread_has_our_outbound,
      count(*) filter (where exists (
        select 1 from activity s
        where s.type = 'email_sent' and s.deleted_at is null
          and s.person_id = reply.person_id
          and s.created_at <= reply.created_at
      ))::int as person_was_emailed_first,
      count(*) filter (where not exists (
        select 1 from activity s
        where s.type = 'email_sent' and s.deleted_at is null
          and s.person_id = reply.person_id
          and s.created_at <= reply.created_at
      ))::int as never_emailed_by_us
    from reply
  `);

  // Per BD, as the report shows it, for the last 90 days.
  const perBd = await db.execute(sql`
    select b.name as bd,
           count(*) filter (where a.type = 'email_sent')::int as enviados,
           count(*) filter (where a.type = 'reply_received')::int as respuestas,
           count(*) filter (where a.type = 'auto_reply_received')::int as automaticas,
           count(*) filter (where a.type = 'email_bounced')::int as rebotes
    from activity a
    join bd b on b.id = a.actor_bd_id
    where a.deleted_at is null
      and a.type in ('email_sent','reply_received','auto_reply_received','email_bounced')
      and a.created_at >= now() - interval '90 days'
    group by b.name
    having count(*) filter (where a.type = 'reply_received') > 0
    order by 3 desc
  `);

  console.log(JSON.stringify({ byType, automatic, linked, perBd }, null, 2));
  process.exit(0);
}

void main();
