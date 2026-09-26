/**
 * Copies LinkedIn message signals from legacy `contact` rows onto their
 * `person_bd_connection` rows.
 *
 * The Phase 3 collapse migration created one `person_bd_connection` per
 * legacy contact (linked by `legacy_contact_id`) but did not carry the
 * denormalized message signals over: every connection was left with zero
 * messages, no dates and `reciprocal = false`, while 5,372 legacy contacts
 * have message history. Live writes keep connections up to date since the
 * write cutover (recomputeMessageSignals), so this is a one-time backfill.
 *
 * Only connections that were never touched by a live recompute are updated
 * (message_count = 0 and last_message_at IS NULL), so running it again is a
 * no-op and it never overwrites newer values.
 *
 * Defaults to a DRY RUN that prints how many rows would change. Pass --apply
 * with --actor=<bd id> to update, in one transaction, with one audit_log row.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-connection-signals.ts
 *   npx tsx --env-file=.env.local scripts/backfill-connection-signals.ts --apply --actor=<bd id>
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog } from "../src/db/schema";

const candidates = sql`
  from contact c
  where c.id = pbc.legacy_contact_id
    and pbc.message_count = 0
    and pbc.last_message_at is null
    and (c.message_count > 0 or c.last_message_at is not null or c.reciprocal)`;

async function countCandidates(): Promise<number> {
  const rows = (await db.execute(
    sql`select count(*)::int as n from person_bd_connection pbc where exists (select 1 ${candidates})`,
  )) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

function parseArgs(argv: string[]): { apply: boolean; actor: string | null } {
  const known = new Set(["--apply"]);
  let actor: string | null = null;
  let apply = false;
  for (const arg of argv) {
    if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (known.has(arg)) apply = true;
    else throw new Error(`Unknown argument: ${arg}. Valid: --apply, --actor=<bd id>`);
  }
  if (apply && !actor) throw new Error("--apply requires --actor=<bd id> for the audit log");
  return { apply, actor };
}

async function main() {
  const { apply, actor } = parseArgs(process.argv.slice(2));
  const before = await countCandidates();
  console.log(`Connections to backfill: ${before}`);
  if (!apply) {
    console.log("Dry run only — nothing written. Re-run with --apply --actor=<bd id>.");
    return;
  }

  const updated = await db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`
      update person_bd_connection pbc
      set message_count = c.message_count,
          sent_count = c.sent_count,
          received_count = c.received_count,
          first_message_at = c.first_message_at,
          last_message_at = c.last_message_at,
          initiated_by_me = c.initiated_by_me,
          reciprocal = c.reciprocal
      ${candidates}
      returning pbc.person_id`)) as unknown as { person_id: string }[];
    await tx.insert(auditLog).values({
      actorBdId: actor!,
      action: "migration_backfill_signals",
      metadata: { connectionsUpdated: rows.length },
    });
    return rows.length;
  });

  console.log(`Updated ${updated} connections. Remaining candidates: ${await countCandidates()}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
