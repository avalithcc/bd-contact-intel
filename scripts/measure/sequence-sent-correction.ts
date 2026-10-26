// Read-only: how much the "Enviados" tile rises once it counts sent_at instead
// of the member state. A member who was sent to and then discarded (a bounce, an
// opt-out, or a manual removal after the send) is missing from today's count.
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  console.log(`read_only: ${JSON.stringify(guard[0] ?? guard)}\n`);

  const totals = await db.execute(sql`
    select
      count(*) filter (where sent_at is not null)::int                                as sent_at_real,
      count(*) filter (where state in ('sent','replied','no_reply'))::int             as sent_hoy,
      count(*) filter (where state = 'discarded' and sent_at is not null)::int        as faltaban,
      count(*) filter (where state = 'discarded' and sent_at is not null
                         and discard_reason in ('bounce','opt_out'))::int             as no_contactables,
      count(*) filter (where state = 'discarded' and sent_at is null
                         and discard_reason in ('bounce','opt_out'))::int             as nunca_salio
    from sequence_member
  `);
  console.log(`totales: ${JSON.stringify(totals, null, 2)}`);

  const perSeq = await db.execute(sql`
    select s.name,
           count(*) filter (where sm.sent_at is not null)::int as enviados_reales,
           count(*) filter (where sm.state = 'discarded' and sm.sent_at is not null
                              and sm.discard_reason in ('bounce','opt_out'))::int as no_contactables
    from sequence_member sm
    join sequence s on s.id = sm.sequence_id
    group by s.name
    having count(*) filter (where sm.state = 'discarded' and sm.sent_at is not null) > 0
    order by 2 desc
  `);
  console.log(`\nsecuencias afectadas: ${JSON.stringify(perSeq, null, 2)}`);
  process.exit(0);
}

void main();
