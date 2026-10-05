/**
 * Owner-operated re-backfill of ONE already-synced Gmail account.
 *
 * WHAT THIS DOES, PLAINLY: it makes the account re-fetch up to two years of
 * mail (BACKFILL_WINDOW_DAYS, src/lib/gmail/backfillWindow.ts) over the next
 * cron turns. That costs Gmail API quota: one `messages.list` page of 50 plus
 * one `messages.get` per message, one page per 2-minute turn per account, so a
 * busy mailbox takes hours. While it runs, that account takes the backfill path
 * instead of the incremental one: mail arriving AFTER the backfill read the
 * newest page is not picked up (the fresh history cursor is taken only when the
 * backfill completes). Reset one account at a time, at a quiet hour.
 *
 * Why a reset is needed: raising the window alone changes nothing for accounts
 * that are already connected. They hold a `history_id`, so
 * syncOneAccountNow.ts takes the incremental path and never runs the
 * backfill again. With `history_id = NULL` the next turn backfills, seeds a
 * new `history_id` when the last page is drained, and goes back to incremental.
 * That is the reset this script performs, the same one syncOneAccountNow.ts
 * applies by itself when `history.list` goes stale: `history_id`,
 * `backfill_page_token` and `sync_error` set to NULL, nothing else.
 *
 * Safe to re-run, and existing stored messages are NOT deleted. The message
 * write is idempotent on `gmail_message_id`: `email_message` has
 * `unique(bd_id, gmail_message_id)` and the insert is `ON CONFLICT DO NOTHING`
 * (src/lib/gmail/syncQueries.ts); person links and activities are written only
 * for rows actually inserted (src/lib/gmail/syncWriteCore.ts), so a re-fetched
 * message adds no duplicate row, link or activity. Only genuinely new
 * (older) mail is stored.
 *
 * ORDERING, READ THIS FIRST: the sync stores a message only when at least one
 * participant is already a known person in the CRM (`shouldStoreClassifiedMessage`,
 * src/lib/gmail/classify.ts). A re-backfill run BEFORE new contacts are
 * imported discards their historical mail, and the incremental path never goes
 * back for it. Run this ONLY AFTER the contact imports (PR #337 adds 70
 * commercial contacts) have been applied.
 *
 * Defaults to a DRY RUN: read-only; prints the account's state (status, last
 * sync, whether a backfill is pending, stored-message count and date range)
 * and exactly what would change. Counts and dates only, never message
 * contents, subjects or addresses other than the account's own.
 * `--execute --actor=<bd id>` applies the reset in ONE transaction with ONE
 * `audit_log` row (action `gmail_rebackfill`).
 *
 * Refuses (exit 1, nothing written) when the account is not `connected`, lacks
 * a refresh token or the readonly scope, has a backfill already in progress or
 * pending, or `--actor` is not a real `bd` row.
 *
 * Revert: the audit row records the previous `history_id`. Only BEFORE the
 * first cron turn after the reset, `UPDATE email_account SET history_id =
 * '<previous>' WHERE bd_id = '<bd id>'` puts the account back on the
 * incremental path (the cursor must still be inside Gmail's history retention,
 * about a week, or the next turn re-baselines anyway). Once the backfill has
 * started there is nothing to undo: it only adds messages.
 *
 * Usage (do NOT run automatically: this reads the real database):
 *   npx tsx --env-file=.env.local scripts/rebackfill-gmail-account.ts --email=someone@avalith.net
 *   npx tsx --env-file=.env.local scripts/rebackfill-gmail-account.ts --email=someone@avalith.net --execute --actor=<bd id>
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, bd, emailAccount, emailMessage } from "../src/db/schema";
import { BACKFILL_WINDOW_DAYS } from "../src/lib/gmail/backfillWindow";
import { planGmailRebackfill, type RebackfillAccountState } from "../src/lib/gmail/rebackfillPlan";

interface Args {
  email: string | null;
  execute: boolean;
  actor: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let email: string | null = null;
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false; // explicit no-op, dry run is the default
    else if (arg.startsWith("--email=")) email = arg.slice("--email=".length);
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --email=<account email>, --execute, --actor=<bd id>`);
  }
  return { email, execute, actor };
}

// Raw-sql aggregates come back as strings (and dates as strings or Dates).
const toDate = (v: Date | string | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v));
const day = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : "none");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email?.trim().toLowerCase() ?? "";
  if (!email) throw new Error("--email=<account email> is required");
  if (args.execute && !args.actor) throw new Error("--execute requires --actor=<bd id> for the audit log");

  // Two round trips, deliberately NOT one correlated query. Interpolating
  // `${emailAccount.bdId}` inside a `sql` subquery emits the column
  // UNQUALIFIED (`"bd_id"`), and Postgres resolves an unqualified name
  // against the innermost scope first — so `where m.bd_id = "bd_id"` became
  // `m.bd_id = m.bd_id`, always true, and the "stored messages" figure was
  // the count for EVERY account (361 instead of this account's 239). It did
  // not fail, it reported a plausible wrong number, and that number is also
  // written into the audit_log row. Reading the account first and counting
  // with a bound parameter cannot be shadowed.
  const [account] = await db
    .select({
      bdId: emailAccount.bdId,
      status: emailAccount.status,
      grantedScopes: emailAccount.grantedScopes,
      hasRefreshToken: sql<boolean>`${emailAccount.refreshTokenEncrypted} is not null`,
      historyId: emailAccount.historyId,
      backfillPageToken: emailAccount.backfillPageToken,
      lastSyncedAt: emailAccount.lastSyncedAt,
      syncError: emailAccount.syncError,
    })
    .from(emailAccount)
    .where(sql`lower(${emailAccount.emailAddress}) = ${email}`)
    .limit(1);

  const [stats] = account
    ? await db
        .select({
          msgCount: sql<number | string>`count(*)`,
          msgOldest: sql<Date | string | null>`min(${emailMessage.sentAt})`,
          msgNewest: sql<Date | string | null>`max(${emailMessage.sentAt})`,
        })
        .from(emailMessage)
        .where(eq(emailMessage.bdId, account.bdId))
    : [{ msgCount: 0, msgOldest: null, msgNewest: null }];

  const row = account ? { ...account, ...stats } : undefined;

  let actorExists: boolean | null = null;
  if (args.actor) {
    const [a] = await db.select({ id: bd.id }).from(bd).where(eq(bd.id, args.actor)).limit(1);
    actorExists = Boolean(a);
  }

  if (row) {
    const oldest = toDate(row.msgOldest);
    const newest = toDate(row.msgNewest);
    console.log(`Account ${email} (bd ${row.bdId})`);
    console.log(`  status:              ${row.status}`);
    console.log(`  last synced:         ${toDate(row.lastSyncedAt)?.toISOString() ?? "never"}`);
    console.log(`  sync error recorded: ${row.syncError ? "yes" : "no"}`);
    console.log(`  history_id:          ${row.historyId ? "set (incremental sync)" : "null"}`);
    console.log(`  backfill pending:    ${row.backfillPageToken || !row.historyId ? "yes" : "no"}`);
    console.log(`  stored messages:     ${Number(row.msgCount)} (${day(oldest)} .. ${day(newest)})`);
  }

  const state: RebackfillAccountState | null = row
    ? {
        status: row.status,
        grantedScopes: row.grantedScopes,
        hasRefreshToken: Boolean(row.hasRefreshToken),
        historyId: row.historyId,
        backfillPageToken: row.backfillPageToken,
      }
    : null;
  const decision = planGmailRebackfill({ account: state, actorExists });
  if (!decision.ok || !row) {
    console.error(`\nRefusing: ${decision.ok ? "no matching account" : decision.message}.`);
    process.exitCode = 1;
    return;
  }

  console.log("\nWould change email_account:");
  console.log("  history_id          set -> NULL   (next cron turn takes the backfill path)");
  console.log("  backfill_page_token NULL -> NULL  (starts from the newest page)");
  console.log("  sync_error          cleared");
  console.log(`Next turns re-fetch up to ${BACKFILL_WINDOW_DAYS} days of mail, one 50-message page per 2-minute turn.`);
  console.log("Existing stored messages are kept; re-fetched ones are skipped (unique bd_id + gmail_message_id).");
  console.log("Run only AFTER the contact imports are applied (see the file header).");

  if (!args.execute) {
    console.log("\nDry run only, nothing was written.");
    console.log("Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  // One transaction: the reset and its audit row stand or fall together. The
  // WHERE re-checks the refusal conditions so a cron turn that moved the
  // account since the read above makes this a no-op that rolls back.
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(emailAccount)
      .set({ ...decision.patch, updatedAt: new Date() })
      .where(
        and(
          eq(emailAccount.bdId, row.bdId),
          eq(emailAccount.status, "connected"),
          isNotNull(emailAccount.historyId),
          isNull(emailAccount.backfillPageToken),
        ),
      )
      .returning({ bdId: emailAccount.bdId });
    if (updated.length !== 1) throw new Error("Account changed since it was read (a sync turn ran); nothing written. Re-run.");

    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: "gmail_rebackfill",
      targetBdId: row.bdId,
      metadata: {
        windowDays: BACKFILL_WINDOW_DAYS,
        previousHistoryId: row.historyId,
        previousLastSyncedAt: toDate(row.lastSyncedAt)?.toISOString() ?? null,
        storedMessages: Number(row.msgCount),
        storedOldest: toDate(row.msgOldest)?.toISOString() ?? null,
        storedNewest: toDate(row.msgNewest)?.toISOString() ?? null,
        note:
          "Reset by scripts/rebackfill-gmail-account.ts. Revert before the first cron turn: " +
          "UPDATE email_account SET history_id = previousHistoryId. Stored messages are never deleted.",
      },
    });
  });

  console.log(`\nReset applied for bd ${row.bdId}; audit_log row written (action gmail_rebackfill).`);
  console.log("The next cron turns start the backfill. Watch /account/email for the backfilling state.");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
