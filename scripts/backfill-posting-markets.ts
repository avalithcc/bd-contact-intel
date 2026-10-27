/**
 * Recompute `job_posting.market` and `job_posting.is_miami` for every row with the classifier the application uses
 * (src/lib/hiring/markets.ts#classifyMarket / #isMiamiArea). Both are pure functions of `location`, so this only writes the rows
 * whose stored value disagrees with today's rules.
 *
 * When to run it: after ANY edit of the rules in markets.ts. sync.ts recomputes the rows the ATS feed still returns on its next
 * daily run, but never touches a closed posting, so without this a rules edit leaves stored data on a mix of old and new rules.
 * Deploy the new rules FIRST (otherwise the next sync with the old code rewrites the open rows back), then run this.
 *
 * Gated like the other prod data changes (scripts/backfill-company-account-type.ts, scripts/unify-contacts.ts):
 *   - Defaults to a DRY RUN: a read-only transaction that prints COUNTS ONLY (no ids, no location text) and writes nothing.
 *   - `--execute --actor=<bd id>` is required to write. It first takes a pg_dump of `job_posting` to backups/ (verified with
 *     pg_restore --list; the run aborts if the backup fails), then writes in ONE transaction, batched, together with ONE audit_log
 *     row (action `posting_market_backfill`) whose metadata holds every previous value.
 *   - Revert: the SQL documented on buildMarketBackfillAuditMetadata (src/lib/hiring/marketBackfill.ts), or pg_restore of the dump.
 *   - Idempotent: a second run plans zero changes.
 *
 * Usage (the owner runs --execute after reviewing the dry run):
 *   npx tsx --env-file=.env scripts/backfill-posting-markets.ts
 *   npx tsx --env-file=.env scripts/backfill-posting-markets.ts --execute --actor=<bd id>
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog } from "../src/db/schema";
import {
  buildMarketBackfillAuditMetadata,
  MARKET_BACKFILL_ACTION,
  planPostingMarketChanges,
  summarizePostingMarketChanges,
  type PostingMarketChange,
  type PostingMarketRow,
} from "../src/lib/hiring/marketBackfill";
import { snapshotBackup } from "../src/lib/migration/backup";
import { chunk } from "../src/lib/migration/collapseWriteRows";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PAGE_SIZE = 5000;
const WRITE_BATCH_SIZE = 500;
const MAX_ROWS = 200_000;

async function readAllPostings(tx: Tx): Promise<PostingMarketRow[]> {
  const rows: PostingMarketRow[] = [];
  let lastId: string | null = null;
  for (;;) {
    const page = (await tx.execute(sql`
      select id::text as id, location, market, is_miami as "isMiami"
      from job_posting
      where ${lastId === null ? sql`true` : sql`id > ${lastId}::uuid`}
      order by id
      limit ${PAGE_SIZE}`)) as unknown as PostingMarketRow[];
    if (!page.length) break;
    rows.push(...page);
    if (rows.length > MAX_ROWS) throw new Error(`refusing to read more than ${MAX_ROWS} job_posting rows`);
    lastId = page[page.length - 1].id;
  }
  return rows;
}

async function writeChanges(tx: Tx, changes: readonly PostingMarketChange[]): Promise<number> {
  let written = 0;
  for (const batch of chunk(changes, WRITE_BATCH_SIZE)) {
    const values = batch.map((c) => sql`(${c.id}::uuid, ${c.toMarket}::text, ${c.toMiami}::boolean)`);
    const updated = (await tx.execute(sql`
      update job_posting jp set market = v.market, is_miami = v.is_miami
      from (values ${sql.join(values, sql`, `)}) as v(id, market, is_miami)
      where jp.id = v.id
      returning jp.id`)) as unknown as unknown[];
    written += updated.length;
  }
  return written;
}

function printSummary(scanned: number, changes: readonly PostingMarketChange[]) {
  const summary = summarizePostingMarketChanges(changes);
  console.log(`job_posting rows scanned: ${scanned}`);
  console.log(`rows whose stored market or is_miami disagrees with today's rules: ${summary.changed}`);
  for (const [transition, count] of Object.entries(summary.byTransition).sort()) console.log(`  market ${transition}: ${count}`);
  console.log(`  is_miami flips: ${summary.miamiFlips}`);
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const actor = args.find((a) => a.startsWith("--actor="))?.slice("--actor=".length) ?? null;
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log");

  if (!execute) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      const guard = (await tx.execute(sql`show transaction_read_only`)) as unknown as { transaction_read_only: string }[];
      if (guard[0]?.transaction_read_only !== "on") throw new Error("refusing a dry run: the session is not read only");
      const rows = await readAllPostings(tx);
      printSummary(rows.length, planPostingMarketChanges(rows));
    });
    console.log("Dry run only: nothing was written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  const backupPath = await snapshotBackup("posting-market-backfill", ["job_posting"]);
  console.log(`backup written and verified: ${backupPath}`);

  await db.transaction(async (tx) => {
    const rows = await readAllPostings(tx);
    const changes = planPostingMarketChanges(rows);
    printSummary(rows.length, changes);
    if (!changes.length) {
      console.log("Nothing to change: no audit row written.");
      return;
    }
    const metadata = buildMarketBackfillAuditMetadata(rows.length, changes);
    const written = await writeChanges(tx, changes);
    if (written !== changes.length) throw new Error(`planned ${changes.length} updates but wrote ${written}: rolling back`);
    await tx.insert(auditLog).values({ actorBdId: actor!, action: MARKET_BACKFILL_ACTION, metadata });
    console.log(`updated ${written} job_posting row(s) and wrote 1 audit_log row (${MARKET_BACKFILL_ACTION}).`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
