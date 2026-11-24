// Read-only follow-up to replies-are-they-answers.ts: is the inbound that counts as a
// "Respuesta recibida" answering OUR mail, or is it ordinary inbox traffic from someone
// who happens to be a CRM contact? Decided by the shape of its Gmail thread.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  // Is outbound even represented in email_message? If not, the thread test below is unfair.
  const byDirection = await db.execute(sql`
    select direction, count(*)::int as rows, count(distinct gmail_thread_id)::int as threads
    from email_message group by direction order by 2 desc
  `);

  // Per reply: what is the FIRST message of its thread, and did we ever write in that thread?
  const shape = await db.execute(sql`
    with reply as (
      select a.id, m.gmail_thread_id, m.sent_at
      from activity a
      join email_message m
        on m.gmail_message_id = a.metadata->>'gmailMessageId' and m.direction = 'inbound'
      where a.type = 'reply_received' and a.deleted_at is null
    ),
    thread_first as (
      select distinct on (gmail_thread_id) gmail_thread_id, direction as first_direction
      from email_message order by gmail_thread_id, sent_at asc, id
    )
    select
      count(*)::int as replies,
      count(*) filter (where tf.first_direction = 'outbound')::int as we_started_the_thread,
      count(*) filter (where tf.first_direction = 'inbound')::int as they_started_the_thread,
      count(*) filter (where tf.gmail_thread_id is null)::int as thread_unknown
    from reply left join thread_first tf on tf.gmail_thread_id = reply.gmail_thread_id
  `);

  // Of the replies we DID start the thread for, was the opener a sequence send?
  const fromSequence = await db.execute(sql`
    with reply as (
      select a.id, m.gmail_thread_id
      from activity a
      join email_message m
        on m.gmail_message_id = a.metadata->>'gmailMessageId' and m.direction = 'inbound'
      where a.type = 'reply_received' and a.deleted_at is null
    )
    select
      count(*)::int as replies,
      count(*) filter (where exists (
        select 1 from activity s
        where s.type = 'email_sent' and s.deleted_at is null
          and s.metadata->>'gmailThreadId' = reply.gmail_thread_id
          and s.metadata ? 'sequenceId'
      ))::int as thread_opened_by_a_sequence,
      count(*) filter (where exists (
        select 1 from activity s
        where s.type = 'email_sent' and s.deleted_at is null
          and s.metadata->>'gmailThreadId' = reply.gmail_thread_id
      ))::int as thread_has_an_email_sent_activity
    from reply
  `);

  // How concentrated is this? One chatty counterpart can carry the whole column.
  const topCounterparts = await db.execute(sql`
    select m.from_address, count(*)::int as replies
    from activity a
    join email_message m
      on m.gmail_message_id = a.metadata->>'gmailMessageId' and m.direction = 'inbound'
    where a.type = 'reply_received' and a.deleted_at is null
    group by m.from_address order by 2 desc limit 12
  `);

  console.log(JSON.stringify({ byDirection, shape, fromSequence, topCounterparts }, null, 2));
  process.exit(0);
}

void main();
