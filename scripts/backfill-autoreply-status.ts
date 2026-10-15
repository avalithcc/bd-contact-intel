/**
 * MEASUREMENT ONLY: how many Contacts are `replied` solely because an out-of-office was written as
 * `reply_received` before `auto_reply_received` existed. There is deliberately NO write path in this
 * round (no --apply, no --execute): the owner reads the number first, then a later round writes,
 * behind its own gate. The script takes NO flags at all; any argument is refused.
 *
 * Why the subject: migration 0044 defaulted every existing email_message.is_automatic to false, so the
 * flag cannot find old damage; the stored subject can. The rule is the live detector's own prefix rule
 * (hasAutomaticSubjectPrefix), so it UNDER-counts: a responder that keeps "Re: <original subject>"
 * is invisible. Read the number as a floor.
 *
 * Reads are bounded and index-friendly: one candidate read (status = 'replied', not merged, correlated
 * EXISTS on a reply_received, capped), then one activity read and one connection read per chunk of 1000
 * ids. The whole run is a READ ONLY transaction. Output is counts plus a tally of the MATCHED PREFIXES
 * ("out of office", "automatic reply", ...), a fixed vocabulary. A subject is never printed: after the
 * prefix it is free text that usually echoes the original subject and can carry a person's name.
 *
 * Usage (reads only):
 *   npx tsx --env-file=.env.local scripts/backfill-autoreply-status.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { planAutoReplyDamage } from "../src/lib/gmail/autoReplyBackfill";
import { chunk, WRITE_BATCH_SIZE } from "../src/lib/migration/collapseWriteRows";
import { mapRawActivityRow, mapRawConnectionRow, type RawActivityRow, type RawConnectionRow } from "../src/lib/status/rawStatusRows";

const CANDIDATE_CAP = 5000;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const idList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

async function measure(tx: Tx) {
  await tx.execute(sql`set transaction read only`);

  const candidates = await tx.execute<{ id: string; status: string }>(sql`
    select p.id::text as id, p.status
    from person p
    where p.status = 'replied'
      and p.merged_into_id is null
      and exists (select 1 from activity a where a.person_id = p.id and a.type = 'reply_received')
    order by p.id
    limit ${CANDIDATE_CAP + 1}
  `);
  const truncated = candidates.length > CANDIDATE_CAP;
  const persons = candidates.slice(0, CANDIDATE_CAP).map((r) => ({ personId: r.id, status: r.status }));

  // Sequential on purpose: the pool is small and this runs once, outside any request.
  const activityRows = [];
  const connectionRows = [];
  for (const ids of chunk(
    persons.map((p) => p.personId),
    WRITE_BATCH_SIZE,
  )) {
    const acts = await tx.execute<RawActivityRow & Record<string, unknown>>(sql`
      select id::text as id, type, created_at, metadata, person_id::text as person_id
      from activity where person_id in (${idList(ids)})
    `);
    activityRows.push(...acts.map(mapRawActivityRow));
    const conns = await tx.execute<RawConnectionRow & Record<string, unknown>>(sql`
      select bd_id::text as bd_id, sent_count, received_count, last_message_at, person_id::text as person_id
      from person_bd_connection where person_id in (${idList(ids)})
    `);
    connectionRows.push(...conns.map(mapRawConnectionRow));
  }

  return { scanned: persons.length, truncated, plan: planAutoReplyDamage(persons, activityRows, connectionRows) };
}

async function main() {
  const extra = process.argv.slice(2);
  if (extra.length > 0) throw new Error(`Unknown argument: ${extra.join(" ")}. This script is a dry run and takes no flags (there is no --apply in this round).`);

  const { scanned, truncated, plan } = await db.transaction(measure);
  const byStage = new Map<string, number>();
  for (const a of plan.affected) byStage.set(a.wouldBecome, (byStage.get(a.wouldBecome) ?? 0) + 1);

  console.log(`Contacts currently 'replied' with at least one reply_received scanned: ${scanned}${truncated ? ` (CAPPED at ${CANDIDATE_CAP}; the real number is higher)` : ""}`);
  console.log(`Replied ONLY because of an out-of-office-looking reply_received: ${plan.affected.length}`);
  for (const [stage, n] of [...byStage].sort()) console.log(`  would fall back to ${stage}: ${n}`);
  console.log(`Out-of-office-looking reply but other evidence keeps them replied (not damaged): ${plan.alsoHasOtherEvidence}`);
  const byPrefix = new Map<string, number>();
  for (const a of plan.affected) for (const prefix of new Set(a.prefixes)) byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  console.log("");
  console.log("Damaged Contacts by matched subject prefix (a Contact counts once per distinct prefix):");
  for (const [prefix, n] of [...byPrefix].sort((x, y) => y[1] - x[1])) console.log(`  "${prefix}": ${n}`);
  console.log("");
  console.log("Dry run only. Nothing was written. The subject rule under-counts (it matches only subjects that START with an out-of-office prefix).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
