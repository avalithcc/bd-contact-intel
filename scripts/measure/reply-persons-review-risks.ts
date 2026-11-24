// Read-only. Prices the three risks the fresh-context review raised against the reply-persons
// column, so each is decided on a number instead of an argument.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getReportPerBd } from "@/lib/reports/queriesDb";
import { reportPeriodRange } from "@/lib/reports/period";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  // RISK 1 - the header branch is not scoped by bd_id. A reply that qualifies ONLY through a
  // Message-ID belonging to ANOTHER BD's outbound credits the wrong BD (reply-all on a cc'd thread).
  const wrongBd = await db.execute(sql`
    with inbound as (
      select a.actor_bd_id, a.person_id, m.id, m.bd_id, m.gmail_thread_id, m.sent_at, m.rfc_references
      from activity a
      join email_message m
        on m.bd_id = a.actor_bd_id
       and m.gmail_message_id = a.metadata->>'gmailMessageId'
       and m.direction = 'inbound'
      where a.type = 'reply_received' and a.deleted_at is null
        and a.actor_bd_id is not null and a.person_id is not null
    ), scored as (
      select inbound.*,
        exists (select 1 from email_message o where o.direction='outbound'
                 and o.bd_id = inbound.bd_id and o.gmail_thread_id = inbound.gmail_thread_id
                 and o.sent_at <= inbound.sent_at) as thread_ok,
        exists (select 1 from email_message o where o.direction='outbound'
                 and o.rfc_message_id is not null and inbound.rfc_references is not null
                 and o.bd_id = inbound.bd_id
                 and position(o.rfc_message_id in inbound.rfc_references) > 0) as header_same_bd,
        exists (select 1 from email_message o where o.direction='outbound'
                 and o.rfc_message_id is not null and inbound.rfc_references is not null
                 and o.bd_id <> inbound.bd_id
                 and position(o.rfc_message_id in inbound.rfc_references) > 0) as header_other_bd
      from inbound
    )
    select
      count(*)::int as replies_joined,
      count(*) filter (where thread_ok or header_same_bd or header_other_bd)::int as cuentan_hoy,
      count(*) filter (where not thread_ok and not header_same_bd and header_other_bd)::int as solo_por_otro_bd,
      count(distinct person_id) filter (where thread_ok or header_same_bd or header_other_bd)::int as personas_hoy,
      count(distinct person_id) filter (where thread_ok or header_same_bd)::int as personas_si_scopeo
    from scored
  `);

  // RISK 2 - the inner join drops any reply_received with no matching inbound email_message row
  // for the SAME bd. How many disappear from the column without a trace?
  const dropped = await db.execute(sql`
    select
      count(*)::int as reply_activities,
      count(*) filter (where a.metadata->>'gmailMessageId' is null)::int as sin_gmail_message_id,
      count(*) filter (where not exists (
        select 1 from email_message m
        where m.bd_id = a.actor_bd_id
          and m.gmail_message_id = a.metadata->>'gmailMessageId'
          and m.direction = 'inbound'
      ))::int as sin_fila_inbound_del_mismo_bd
    from activity a
    where a.type = 'reply_received' and a.deleted_at is null
  `);

  // RISK 3 - the empty-string hazard: position('' in x) returns 1 for EVERY inbound.
  const emptyIds = await db.execute(sql`
    select count(*) filter (where rfc_message_id = '')::int as message_id_vacio,
           count(*) filter (where rfc_references = '')::int as references_vacio
    from email_message
  `);

  // RISK 4 - worst case the UI allows is a 400-day custom window (MAX_CUSTOM_DAYS).
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const to = new Date();
  const range = reportPeriodRange("custom", to, { from: day(new Date(to.getTime() - 399 * 864e5)), to: day(to) });
  const t0 = Date.now();
  const worst = await getReportPerBd({
    fromIso: range.fromIso, toIso: range.toIso,
    fromDate: range.fromDate, toDateExclusive: range.toDateExclusive, bdId: null,
  });
  const worstMs = Date.now() - t0;

  console.log(JSON.stringify({ wrongBd, dropped, emptyIds, worstCase: { window: `${range.fromDate}..${range.toDateExclusive}`, ms: worstMs, total: worst.replyPersonsTotal } }, null, 2));
  process.exit(0);
}

void main();
