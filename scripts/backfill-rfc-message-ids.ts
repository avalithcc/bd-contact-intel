/**
 * Backfill `email_message.rfc_message_id` / `rfc_references` for messages
 * synced before migration 0036 (reply-to-thread). Until a thread's latest
 * message has a Message-ID the contact record disables "Responder" on it:
 * a reply without In-Reply-To would start a NEW thread in the recipient's
 * mailbox.
 *
 * Defaults to a DRY RUN: reads the database only (no Gmail call, no write)
 * and prints counts per BD of the messages that still lack a Message-ID.
 *
 * `--execute --actor=<bd id>`:
 *   1. selects up to `--limit` (default 500, max 2000) rows with a NULL
 *      rfc_message_id, newest first (one query);
 *   2. re-reads each message from the owning BD's Gmail mailbox with the
 *      same getMessage + parseGmailMessage the sync uses (read-only calls);
 *      a BD whose token cannot be decrypted/refreshed (or whose reads fail)
 *      is skipped and counted, never aborting the other BDs;
 *   3. writes every update in ONE transaction, in batches, each guarded by
 *      `rfc_message_id IS NULL` (never overwrites), together with ONE
 *      `audit_log` row (action `backfill_rfc_message_ids`) that lists every
 *      updated email_message id.
 *
 * Idempotent: updated rows no longer match the candidate query. Messages
 * deleted from Gmail or lacking a Message-ID header stay NULL and are
 * re-counted on every run (they cannot be answered as a thread reply).
 *
 * Revert: take the ids from the audit row's metadata.updatedIds and run
 *   UPDATE email_message SET rfc_message_id = NULL, rfc_references = NULL
 *   WHERE id = ANY(<those ids>::uuid[]);
 * (safe: the script only ever fills rows that were NULL.)
 *
 * The logic lives in src/lib/gmail/rfcBackfillRun.ts, shared with the admin
 * page /admin/rfc-backfill (needed because the token key only exists in
 * production). This file is only the CLI wrapper.
 *
 * Usage (dry run is the default):
 *   npx tsx --env-file=.env.local scripts/backfill-rfc-message-ids.ts
 *   npx tsx --env-file=.env.local scripts/backfill-rfc-message-ids.ts --execute --actor=<bd id> [--limit=500]
 */
import { runRfcBackfill, selectRfcBackfillCandidates } from "../src/lib/gmail/rfcBackfillRun";
import { groupCandidatesByBd } from "../src/lib/gmail/rfcBackfill";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

function parseArgs(argv: string[]): { execute: boolean; actor: string | null; limit: number } {
  let execute = false;
  let actor: string | null = null;
  let limit = DEFAULT_LIMIT;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--limit=")) limit = Number(arg.slice("--limit=".length));
    else throw new Error(`Unknown argument: ${arg}. Valid: --execute, --actor=<bd id>, --limit=<1..${MAX_LIMIT}>`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`--limit must be an integer in 1..${MAX_LIMIT}`);
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log");
  return { execute, actor, limit };
}

async function main() {
  const { execute, actor, limit } = parseArgs(process.argv.slice(2));

  if (!execute) {
    const candidates = await selectRfcBackfillCandidates(limit);
    const perBd = groupCandidatesByBd(candidates);
    console.log(`Messages without a Message-ID (up to --limit=${limit}): ${candidates.length} across ${perBd.size} BD(s)`);
    for (const [bdId, rows] of perBd) console.log(`  bd ${bdId}: ${rows.length}`);
    console.log("Dry run: nothing fetched, nothing written. Re-run with --execute --actor=<bd id>.");
    return;
  }

  const result = await runRfcBackfill({ actorBdId: actor!, limit });
  console.log(`Plan: ${JSON.stringify({ ...result.counts, skippedBds: result.skippedBds, skipReasons: result.skipReasons })}`);
  if (result.updated === 0) return;
  console.log(`Updated ${result.updated} message(s) and wrote 1 audit_log row.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
