/**
 * Read-only: what the DATED "Tasa de respuesta" reports, and what its query costs.
 *
 * Companion to scripts/measure/reply-rate-evidence.ts (which measured the bug). This one runs the
 * replacement — buildReportAggregatesQuery's `rpt_rate_*` CTEs, owner decision 2026-11-06 — for a few
 * windows, prints the new rate next to the old snapshot ratio it replaces, and EXPLAINs both the page's
 * own statement and the tile's drill-down so the plan and the execution time are measurements, not claims.
 *
 * Final semantics being measured (replyRateEvidence.ts): the evidence is `activity` ALONE. LinkedIn
 * `message` rows are out of both sides — 1044 of the 1259 persons in the first version's metric arrived
 * through imported chat traffic, at 55.8% against 36.7% for CRM-recorded outreach. `status_change` /
 * `status_backfill` is outreach only at 'contacted', so a manual move to 'replied' cannot be its own
 * outreach. The `linkedin_only` column below is what the metric would wrongly gain back if anyone
 * restored that arm, so a non-zero value there is information, not a defect.
 *
 * GUARD SCOPE (README rule 1): the guard covers the one connection it is set on, not the pool; every read
 * here is sequential and issues no write.
 *
 * Usage: node --env-file=.env.local -r tsx/cjs scripts/measure/reply-rate-dated.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildRateDrilldownQuery, buildReportAggregatesQuery } from "@/lib/reports/queries";

/** ART is UTC-3, so an ART calendar month starts at 03:00 UTC. */
const WINDOWS: ReadonlyArray<{ label: string; from: string; to: string }> = [
  { label: "mes actual (ART)", from: "2026-11-01T03:00:00Z", to: "2026-12-01T03:00:00Z" },
  { label: "mes anterior (ART)", from: "2026-10-01T03:00:00Z", to: "2026-11-01T03:00:00Z" },
  { label: "2026 completo", from: "2026-01-01T03:00:00Z", to: "2027-01-01T03:00:00Z" },
];

type FunnelJson = { contactedOrMore: number; repliedOrMore: number; rateContacted: number; rateReplied: number };

/**
 * Persons whose only in-window evidence would be LinkedIn traffic — the population the rate deliberately
 * does NOT count. Mirrors the deleted union arm, so the cost of the owner's decision stays visible.
 */
const LINKEDIN_ONLY = (from: string, to: string) => sql`
  select count(*)::int as pbc_count
  from person
  where person.merged_into_id is null
    and person.profile_key is not null
    and exists (
      select 1 from message
      join conversation on conversation.id = message.conversation_id
      where conversation.peer_profile_key = person.profile_key
        and message.is_draft = false
        and message.sent_at >= ${from}::timestamptz
        and message.sent_at < ${to}::timestamptz
    )
    and not exists (
      select 1 from activity
      where activity.person_id = person.id
        and activity.type in ('email_sent', 'call', 'whatsapp', 'status_change', 'status_backfill')
        and activity.created_at >= ${from}::timestamptz
        and activity.created_at < ${to}::timestamptz
    )`;

function pct(numerator: number, denominator: number): string {
  return denominator === 0 ? "—" : `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/** Only the lines that matter: the cost summary and every relation scan. */
async function explain(label: string, query: ReturnType<typeof buildReportAggregatesQuery>) {
  const rows = (await db.execute(sql`explain (analyze, buffers) ${query}`)) as unknown as Array<Record<string, string>>;
  const lines = rows.map((r) => r["QUERY PLAN"] ?? "");
  console.log(`=== plan: ${label} ===`);
  for (const line of lines) {
    if (/Planning Time|Execution Time|Seq Scan on|Index Scan using|Index Only Scan|Bitmap Heap Scan on/.test(line)) {
      console.log(`  ${line.trim()}`);
    }
  }
  console.log("");
}

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  console.log(`read_only: ${JSON.stringify(guard[0] ?? guard)} (this connection)\n`);

  for (const w of WINDOWS) {
    const started = Date.now();
    const rows = (await db.execute(buildReportAggregatesQuery({ fromIso: w.from, toIso: w.to, bdId: null }))) as unknown as Array<{ funnel: FunnelJson }>;
    const elapsed = Date.now() - started;
    const f = rows[0]!.funnel;
    const linkedIn = (await db.execute(LINKEDIN_ONLY(w.from, w.to))) as unknown as Array<{ pbc_count: number }>;
    console.log(`=== ${w.label} ===`);
    console.log(`  tasa fechada (correo/llamada/WhatsApp) : ${f.rateReplied}/${f.rateContacted} = ${pct(f.rateReplied, f.rateContacted)}`);
    console.log(`  instantanea de estado                  : ${f.repliedOrMore}/${f.contactedOrMore} = ${pct(f.repliedOrMore, f.contactedOrMore)}  (lo que mostraba antes del fix)`);
    console.log(`  solo conversacion LinkedIn, fuera      : ${Number(linkedIn[0]?.pbc_count ?? 0)} personas (etapa anterior, decision del owner)`);
    console.log(`  statement completo                     : ${elapsed}ms de ida y vuelta\n`);
  }

  const month = WINDOWS[1]!;
  await explain("buildReportAggregatesQuery (mes)", buildReportAggregatesQuery({ fromIso: month.from, toIso: month.to, bdId: null }));
  await explain("buildRateDrilldownQuery (mes)", buildRateDrilldownQuery({ fromIso: month.from, toIso: month.to, bdId: null }));
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
