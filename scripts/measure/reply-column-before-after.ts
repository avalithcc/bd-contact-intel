// Read-only. The honest before/after for the "Actividad por BD" reply column, dated the way the
// SCREEN dates things.
//
// My first measurement windowed on `activity.created_at` and was wrong: created_at is when the
// Gmail sync WROTE the row, while the report dates email activity by `metadata.occurredAt` (when
// the mail was actually sent/received). The sync imported years of history in the last two months,
// so a created_at window lumps all of it into "the last 90 days".
//
// Self-check built in: this script recomputes `emails_sent` with the same window logic and the
// caller compares it against the live getReportPerBd value. If emails_sent agrees, the window is
// right and the old-column number next to it can be trusted.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getReportPerBd } from "@/lib/reports/queriesDb";
import { reportPeriodRange, type ReportPeriod } from "@/lib/reports/period";

// Mirrors happenedAtSql() for the two email types only (src/lib/reports/queries.ts).
const happenedAt = sql`coalesce(
  case when activity.type in ('email_sent','reply_received')
       then (activity.metadata->>'occurredAt')::timestamptz end,
  activity.created_at)`;

async function run(period: ReportPeriod, custom?: { from: string; to: string } | null) {
  const range = reportPeriodRange(period, new Date(), custom ?? null);
  const live = await getReportPerBd({
    fromIso: range.fromIso,
    toIso: range.toIso,
    fromDate: range.fromDate,
    toDateExclusive: range.toDateExclusive,
    bdId: null,
  });
  const old = await db.execute<{ bd: string; emails_sent: number; old_replies: number }>(sql`
    select b.name as bd,
           count(*) filter (where activity.type = 'email_sent')::int as emails_sent,
           count(*) filter (where activity.type = 'reply_received')::int as old_replies
    from activity
    join bd b on b.id = activity.actor_bd_id
    where activity.deleted_at is null
      and activity.type in ('email_sent','reply_received')
      and ${happenedAt} >= ${range.fromIso}::timestamptz
      and ${happenedAt} < ${range.toIso}::timestamptz
    group by b.name
  `);
  const oldBy = new Map(old.map((r) => [r.bd, r]));
  return {
    period,
    window: `${range.fromDate} .. ${range.toDateExclusive}`,
    replyPersonsTotal: live.replyPersonsTotal,
    sumOfRows: live.rows.reduce((a, r) => a + r.replyPersons, 0),
    rows: live.rows.map((r) => {
      const o = oldBy.get(r.bdName);
      return {
        bd: r.bdName,
        emailsSent_live: r.emailsSent,
        emailsSent_myWindow: o?.emails_sent ?? 0,
        windowAgrees: (o?.emails_sent ?? 0) === r.emailsSent,
        columna_vieja: o?.old_replies ?? 0,
        columna_nueva: r.replyPersons,
      };
    }),
  };
}

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const to = new Date();
  const out = [
    await run("month"),
    await run("last_month"),
    await run("custom", { from: day(new Date(to.getTime() - 90 * 864e5)), to: day(to) }),
    await run("custom", { from: day(new Date(to.getTime() - 395 * 864e5)), to: day(to) }),
  ];
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

void main();
