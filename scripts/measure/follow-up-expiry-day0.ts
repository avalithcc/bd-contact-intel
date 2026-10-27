// Read-only: what follow-up-expiry does on ACTIVATION DAY, per BD, using the app's own queries and rules (README rule 2).
//  - how many contacts would enter the queue under the 5-day rule today, and how many of those fit the cap of 10;
//  - that on activation day nothing is Vencido and nothing is auto-dropped: every entry opens its cycle today (day 0), and rows
//    written before the feature carry no cycle date, so none can be carried or overdue;
//  - the timing of the selection query (the only follow-up read that scans every person).
// Works before the migration: it checks whether follow_up_queue_item.cycle_started_on exists and, if not, runs the same
// selection without the cycle exclusion (which cannot exclude anybody while no cycle exists).
// Prints counts only: no names, no ids.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildFollowUpVerificationQuery } from "@/lib/followUp/candidateQuery";
import { classifyQueueItems, cycleStage, daysInQueue } from "@/lib/followUp/cycle";
import { expireOverdueFollowUps } from "@/lib/followUp/dropQueries";
import { argentinaCalendarDate } from "@/lib/tasks/argentinaDate";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  const readOnly = (guard[0] as { transaction_read_only?: string } | undefined)?.transaction_read_only;
  console.log(`transaction_read_only: ${readOnly}`);
  if (readOnly !== "on") throw new Error("refusing to measure: the session is not read only");

  const today = argentinaCalendarDate(new Date());
  const [col] = await db.execute(
    sql`select count(*)::int as n from information_schema.columns where table_name = 'follow_up_queue_item' and column_name = 'cycle_started_on'`,
  );
  const hasCycleColumn = Number((col as { n: number }).n) > 0;
  console.log(`today (ART): ${today}; cycle_started_on column present: ${hasCycleColumn}`);

  const started = Date.now();
  const perBd = (await db.execute(
    sql`select b.name as bd, v.eligible_count, v.queue_count
        from (${buildFollowUpVerificationQuery(10, { includeCycles: hasCycleColumn })}) v
        join bd b on b.id = v.owner_bd_id
        order by v.eligible_count desc`,
  )) as unknown as { bd: string; eligible_count: number; queue_count: number }[];
  console.log(`selection query: ${Date.now() - started} ms`);
  console.table(perBd.map((r) => ({ bd: r.bd, "entran con la regla de 5 días": r.eligible_count, "caben en el cupo de 10": r.queue_count })));

  // Day 0: the rows the materialization would write open their cycle today. Run the real classifier over them.
  const entries = perBd.flatMap((r) =>
    Array.from({ length: r.queue_count }, (_, i) => ({ queueDate: today, cycleStartedOn: today, position: i + 1 })),
  );
  const { today: hoy, overdue } = classifyQueueItems(entries, today);
  const expired = entries.filter((e) => cycleStage(daysInQueue(e.cycleStartedOn, today)) === "expired").length;
  console.log(`day 0 -> Hoy: ${hoy.length}, Vencidos: ${overdue.length}, expired: ${expired}`);

  let carried = 0;
  let wouldExpire = 0;
  if (hasCycleColumn) {
    const [c] = await db.execute(
      sql`select count(*)::int as n from follow_up_queue_item where cycle_started_on is not null`,
    );
    carried = Number((c as { n: number }).n);
    wouldExpire = await expireOverdueFollowUps(today, db, { dryRun: true });
  }
  console.log(`rows with a cycle date already: ${carried}; the expiry job would drop today: ${wouldExpire}`);
  process.exit(0);
}

void main();
