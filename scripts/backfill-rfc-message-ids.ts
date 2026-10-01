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
 *      a BD whose token cannot be refreshed is skipped and counted;
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
 * Usage (dry run is the default):
 *   npx tsx --env-file=.env.local scripts/backfill-rfc-message-ids.ts
 *   npx tsx --env-file=.env.local scripts/backfill-rfc-message-ids.ts --execute --actor=<bd id> [--limit=500]
 */
import { desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, emailAccount, emailMessage } from "../src/db/schema";
import { decryptToken } from "../src/lib/gmail/crypto";
import { refreshGmailAccessToken } from "../src/lib/gmail/accessToken";
import { createGmailClient } from "../src/lib/gmail/client";
import { parseGmailMessage, type ParsedGmailMessage } from "../src/lib/gmail/parseMessage";
import { backfillKey, planRfcBackfill, type BackfillCandidate } from "../src/lib/gmail/rfcBackfill";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const BATCH = 200;

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

  const candidates: BackfillCandidate[] = await db
    .select({ id: emailMessage.id, bdId: emailMessage.bdId, gmailMessageId: emailMessage.gmailMessageId })
    .from(emailMessage)
    .where(isNull(emailMessage.rfcMessageId))
    .orderBy(desc(emailMessage.sentAt))
    .limit(limit);

  const perBd = new Map<string, BackfillCandidate[]>();
  for (const c of candidates) perBd.set(c.bdId, [...(perBd.get(c.bdId) ?? []), c]);

  console.log(`Messages without a Message-ID (up to --limit=${limit}): ${candidates.length} across ${perBd.size} BD(s)`);
  for (const [bdId, rows] of perBd) console.log(`  bd ${bdId}: ${rows.length}`);
  if (!execute) {
    console.log("Dry run: nothing fetched, nothing written. Re-run with --execute --actor=<bd id>.");
    return;
  }

  const fetched = new Map<string, ParsedGmailMessage>();
  let skippedBds = 0;
  for (const [bdId, rows] of perBd) {
    const [account] = await db.select().from(emailAccount).where(eq(emailAccount.bdId, bdId));
    if (!account || account.status !== "connected" || !account.refreshTokenEncrypted) {
      skippedBds++;
      continue;
    }
    const token = await refreshGmailAccessToken(decryptToken(account.refreshTokenEncrypted));
    if (!token.ok) {
      skippedBds++;
      continue;
    }
    const client = createGmailClient(token.accessToken);
    for (const row of rows) {
      const message = await client.getMessage(row.gmailMessageId);
      if (message) fetched.set(backfillKey(row.bdId, row.gmailMessageId), parseGmailMessage(message));
    }
  }

  const plan = planRfcBackfill(candidates, fetched);
  console.log(`Plan: ${JSON.stringify({ ...plan.counts, skippedBds })}`);
  if (plan.updates.length === 0) return;

  await db.transaction(async (tx) => {
    for (let i = 0; i < plan.updates.length; i += BATCH) {
      const chunk = plan.updates.slice(i, i + BATCH);
      const tuples = sql.join(
        chunk.map((u) => sql`(${u.id}::uuid, ${u.rfcMessageId}::text, ${u.rfcReferences}::text)`),
        sql`, `,
      );
      await tx.execute(sql`
        update email_message em
        set rfc_message_id = v.mid, rfc_references = v.refs
        from (values ${tuples}) as v(id, mid, refs)
        where em.id = v.id and em.rfc_message_id is null
      `);
    }
    await tx.insert(auditLog).values({
      actorBdId: actor!,
      action: "backfill_rfc_message_ids",
      metadata: { counts: plan.counts, skippedBds, updatedIds: plan.updates.map((u) => u.id) },
    });
  });
  console.log(`Updated ${plan.updates.length} message(s) and wrote 1 audit_log row.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
