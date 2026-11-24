// Read-only smoke test of the SCREEN'S OWN query after the reply-persons change: calls
// getReportPerBd exactly as src/app/(app)/admin/reports/page.tsx does, for every period the
// UI offers, and times it. Never transcribes the SQL - a transcription can agree with itself
// and still disagree with the page.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getReportPerBd } from "@/lib/reports/queriesDb";
import { reportPeriodRange, type ReportPeriod } from "@/lib/reports/period";

async function run(period: ReportPeriod, custom?: { from: string; to: string } | null) {
  const now = new Date();
  const range = reportPeriodRange(period, now, custom ?? null);
  const t0 = Date.now();
  const { rows, replyPersonsTotal } = await getReportPerBd({
    fromIso: range.fromIso,
    toIso: range.toIso,
    fromDate: range.fromDate,
    toDateExclusive: range.toDateExclusive,
    bdId: null,
  });
  const ms = Date.now() - t0;
  return {
    period,
    window: `${range.fromIso} -> ${range.toIso}`,
    ms,
    replyPersonsTotal,
    sumOfRows: rows.reduce((a, r) => a + r.replyPersons, 0),
    rows: rows.map((r) => ({ bd: r.bdName, emailsSent: r.emailsSent, replyPersons: r.replyPersons })),
  };
}

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const out = [];
  for (const p of ["week", "month", "last_month"] as const) out.push(await run(p));
  // A 90-day custom window, to compare against the measurement that drove the decision.
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 864e5);
  out.push(await run("custom", { from: day(from), to: day(to) }));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

void main();
