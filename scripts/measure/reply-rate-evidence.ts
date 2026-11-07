/**
 * Read-only: what the reports "Tasa de respuesta" tile is actually counting.
 *
 * The tile's numerator (src/lib/reports/queries.ts#buildReportAggregatesQuery, `pbc_rate_replied`) is
 * `person.status in ('replied','meeting')` over the persons CREATED in the period. `person.status` is a
 * cache derived by src/lib/status/deriveStatus.ts, and `connectionStageCandidate` promotes a person to
 * `replied` whenever a `person_bd_connection` row has `received_count > 0` — the imported LinkedIn
 * conversation history. That evidence carries no period: a LinkedIn message received years before the
 * outreach still makes the person `replied` today, so it lands in the numerator of whatever period the
 * person happens to have been created in.
 *
 * This script splits the numerator by the evidence that put each person there, and ages the
 * LinkedIn-only ones (how far `last_message_at` sits before the person's own `created_at`), so the size
 * of the distortion is a measurement and not an argument.
 *
 * GUARD SCOPE (README rule 1): the guard covers the one connection it is set on, not the pool; every read
 * here is sequential and issues no write.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

/** ART is UTC-3, so an ART calendar month starts at 03:00 UTC. */
const WINDOWS: ReadonlyArray<{ label: string; from: string; to: string }> = [
  { label: "mes actual (ART)", from: "2026-11-01T03:00:00Z", to: "2026-12-01T03:00:00Z" },
  { label: "mes anterior (ART)", from: "2026-10-01T03:00:00Z", to: "2026-11-01T03:00:00Z" },
  { label: "2026 completo", from: "2026-01-01T03:00:00Z", to: "2027-01-01T03:00:00Z" },
  { label: "todo el historico", from: "1970-01-01T00:00:00Z", to: "2100-01-01T00:00:00Z" },
];

/** Mirrors src/lib/reports/currentClient.ts#notCurrentClientPersonSql(). */
const NOT_CLIENT = sql`not exists (
  select 1 from company as cc_client
  where cc_client.relationship_stage = 'won'
    and cc_client.client_status = 'active'
    and cc_client.company_key = coalesce(
      (select cc_alias.company_key from company_alias as cc_alias
        where cc_alias.alias_key = person.company_key
          and not exists (select 1 from company as cc_live where cc_live.company_key = cc_alias.alias_key)),
      person.company_key
    )
)`;

/** Every activity that reaches rank >= replied in deriveStatus.ts (reply_received, meeting_logged, connected call, replied whatsapp, manual stage). */
const HAS_REPLY_ACTIVITY = sql`exists (
  select 1 from activity as ra
  where ra.person_id = person.id
    and (
      ra.type in ('reply_received','meeting_logged')
      or (ra.type = 'call' and ra.metadata->>'outcome' = 'connected')
      or (ra.type = 'whatsapp' and ra.metadata->>'outcome' = 'replied')
      or (ra.type in ('status_change','status_backfill') and ra.metadata->>'status' in ('replied','meeting'))
    )
)`;

const HAS_LINKEDIN_INBOUND = sql`exists (
  select 1 from person_bd_connection as pc
  where pc.person_id = person.id and pc.received_count > 0 and pc.last_message_at is not null
)`;

type Split = { total: number; activity_only: number; linkedin_only: number; both: number; neither: number };

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  console.log(`read_only: ${JSON.stringify(guard[0] ?? guard)} (this connection)\n`);

  for (const w of WINDOWS) {
    const rows = (await db.execute(sql`
      select
        count(*)::int as total,
        count(*) filter (where ${HAS_REPLY_ACTIVITY} and not ${HAS_LINKEDIN_INBOUND})::int as activity_only,
        count(*) filter (where not ${HAS_REPLY_ACTIVITY} and ${HAS_LINKEDIN_INBOUND})::int as linkedin_only,
        count(*) filter (where ${HAS_REPLY_ACTIVITY} and ${HAS_LINKEDIN_INBOUND})::int as both,
        count(*) filter (where not ${HAS_REPLY_ACTIVITY} and not ${HAS_LINKEDIN_INBOUND})::int as neither
      from person
      where person.merged_into_id is null
        and person.created_at >= ${w.from}::timestamptz
        and person.created_at < ${w.to}::timestamptz
        and person.status in ('replied','meeting')
        and ${NOT_CLIENT}
    `)) as unknown as Split[];
    const denomRows = (await db.execute(sql`
      select count(*)::int as denom
      from person
      where person.merged_into_id is null
        and person.created_at >= ${w.from}::timestamptz
        and person.created_at < ${w.to}::timestamptz
        and person.status in ('contacted','replied','meeting')
        and ${NOT_CLIENT}
    `)) as unknown as Array<{ denom: number }>;
    const s = rows[0];
    const denom = denomRows[0]?.denom ?? 0;
    const pct = (n: number) => (denom === 0 ? "—" : `${((n / denom) * 100).toFixed(1)}%`);
    console.log(`=== ${w.label} ===`);
    console.log(`  tasa que muestra el reporte : ${s.total}/${denom} = ${pct(s.total)}`);
    console.log(`  respuesta real (actividad)  : ${s.activity_only + s.both}  -> tasa ${pct(s.activity_only + s.both)}`);
    console.log(`  SOLO conversacion LinkedIn  : ${s.linkedin_only}  (${pct(s.linkedin_only)} de inflado)`);
    console.log(`  ambas evidencias            : ${s.both}`);
    console.log(`  sin evidencia de respuesta  : ${s.neither}`);
    console.log("");
  }

  console.log("=== antiguedad de los que entran SOLO por LinkedIn (todo el historico) ===");
  const age = (await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where pbc_days_before > 0)::int as before_creation,
      count(*) filter (where pbc_days_before > 365)::int as over_1y_before,
      round(avg(pbc_days_before))::int as avg_days_before,
      max(pbc_days_before)::int as max_days_before,
      min(pbc_last_at)::text as oldest_message,
      max(pbc_last_at)::text as newest_message
    from (
      select
        (select max(pc.last_message_at) from person_bd_connection as pc where pc.person_id = person.id and pc.received_count > 0) as pbc_last_at,
        extract(day from person.created_at - (select max(pc.last_message_at) from person_bd_connection as pc where pc.person_id = person.id and pc.received_count > 0))::int as pbc_days_before
      from person
      where person.merged_into_id is null
        and person.status in ('replied','meeting')
        and ${NOT_CLIENT}
        and not ${HAS_REPLY_ACTIVITY}
        and ${HAS_LINKEDIN_INBOUND}
    ) as aged
  `)) as unknown as Array<Record<string, unknown>>;
  console.log(age[0]);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
