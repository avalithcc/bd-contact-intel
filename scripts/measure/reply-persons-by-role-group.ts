// Read-only. How much would excluding the `developers` role group change the "Personas que
// respondieron" column, and what does it do to "Correos enviados" in the same row? If replies
// drop devs and sends do not, the two numbers in one row describe different populations.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { reportPeriodRange, type ReportPeriod } from "@/lib/reports/period";

const happenedAt = sql`coalesce(
  case when activity.type in ('email_sent','reply_received')
       then (activity.metadata->>'occurredAt')::timestamptz end,
  activity.created_at)`;

async function run(period: ReportPeriod, custom?: { from: string; to: string } | null) {
  const range = reportPeriodRange(period, new Date(), custom ?? null);
  const rows = await db.execute<Record<string, number | string>>(sql`
    with links as (
      select activity.actor_bd_id as bd_id, activity.person_id, person.role_group
      from activity
      join email_message inb
        on inb.bd_id = activity.actor_bd_id
       and inb.gmail_message_id = activity.metadata->>'gmailMessageId'
       and inb.direction = 'inbound'
      join person on person.id = activity.person_id
      where activity.type = 'reply_received' and activity.deleted_at is null
        and activity.actor_bd_id is not null and activity.person_id is not null
        and ${happenedAt} >= ${range.fromIso}::timestamptz
        and ${happenedAt} <  ${range.toIso}::timestamptz
        and (
          exists (select 1 from email_message o where o.direction='outbound'
                   and o.bd_id = inb.bd_id and o.gmail_thread_id = inb.gmail_thread_id
                   and o.sent_at <= inb.sent_at)
          or (inb.rfc_references is not null and exists (
               select 1 from email_message o where o.direction='outbound'
                 and o.bd_id = inb.bd_id and o.rfc_message_id is not null and o.rfc_message_id <> ''
                 and position(o.rfc_message_id in inb.rfc_references) > 0))
        )
    ),
    sends as (
      select activity.actor_bd_id as bd_id,
             count(*)::int as enviados,
             count(*) filter (where person.role_group = 'developers')::int as enviados_a_devs
      from activity join person on person.id = activity.person_id
      where activity.type = 'email_sent' and activity.deleted_at is null
        and activity.actor_bd_id is not null
        and ${happenedAt} >= ${range.fromIso}::timestamptz
        and ${happenedAt} <  ${range.toIso}::timestamptz
      group by activity.actor_bd_id
    )
    select b.name as bd,
      coalesce(sends.enviados, 0) as enviados,
      coalesce(sends.enviados_a_devs, 0) as enviados_a_devs,
      count(distinct links.person_id)::int as personas_hoy,
      count(distinct links.person_id) filter (where links.role_group = 'developers')::int as personas_dev,
      count(distinct links.person_id) filter (where links.role_group is distinct from 'developers')::int as personas_sin_dev
    from links
    join bd b on b.id = links.bd_id
    left join sends on sends.bd_id = links.bd_id
    group by b.name, sends.enviados, sends.enviados_a_devs
    order by 4 desc
  `);
  const totals = await db.execute<{ t: number; t_sin_dev: number }>(sql`
    with links as (
      select activity.person_id, person.role_group
      from activity
      join email_message inb
        on inb.bd_id = activity.actor_bd_id
       and inb.gmail_message_id = activity.metadata->>'gmailMessageId'
       and inb.direction = 'inbound'
      join person on person.id = activity.person_id
      where activity.type = 'reply_received' and activity.deleted_at is null
        and activity.actor_bd_id is not null and activity.person_id is not null
        and ${happenedAt} >= ${range.fromIso}::timestamptz
        and ${happenedAt} <  ${range.toIso}::timestamptz
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
    select count(distinct person_id)::int as t,
           count(distinct person_id) filter (where role_group is distinct from 'developers')::int as t_sin_dev
    from links
  `);
  return { period, window: `${range.fromDate}..${range.toDateExclusive}`, totals: totals[0], rows };
}

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const to = new Date();
  const out = [
    await run("month"),
    await run("last_month"),
    await run("custom", { from: day(new Date(to.getTime() - 395 * 864e5)), to: day(to) }),
  ];
  // What is actually in role_group across the people who reply at all?
  const spread = await db.execute(sql`
    select coalesce(person.role_group, '(null)') as role_group, count(distinct person.id)::int as personas
    from activity join person on person.id = activity.person_id
    where activity.type = 'reply_received' and activity.deleted_at is null
    group by 1 order by 2 desc
  `);
  console.log(JSON.stringify({ out, spread }, null, 2));
  process.exit(0);
}

void main();
