import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { isValidBearer } from "@/lib/cronAuth";
import { getSyncableAccounts, updateAccountAfterSync } from "@/lib/gmail/syncQueries";
import { syncOneAccountNow } from "@/lib/gmail/syncOneAccountNow";

/**
 * Polls every connected, readonly-scoped BD's Gmail inbox for CRM-matched
 * mail (email-sync brief). Triggered by Supabase `pg_cron` + `pg_net` every
 * 2 minutes (see scripts/gmail-sync-cron.sql, run once by the orchestrator
 * after owner approval) with the same bearer convention as
 * src/app/api/tasks/digest/route.ts, plus a daily Vercel cron safety net
 * (vercel.json) since the Hobby plan cannot schedule anything more frequent.
 *
 * Accounts are processed SEQUENTIALLY, never `Promise.all` — prod's
 * connection pool is `max: 3` (PERFORMANCE.md) and this cron already shares
 * it with live traffic. Each BD's turn gets its own try/catch and time
 * budget (`PER_BD_BUDGET_MS`) so one broken/slow mailbox can never starve or
 * crash every other BD's sync in the same run.
 *
 * An account with no stored `historyId` yet (a fresh connection, or one
 * reset after a stale/404 `history.list`) runs the first-sync 90-day
 * backfill instead of incremental polling (src/lib/gmail/backfillAccount.ts)
 * — one bounded `messages.list` page per run, resumable via
 * `backfill_page_token`, until it seeds a fresh `historyId` and switches
 * that account over to incremental sync.
 *
 * To trigger a real run manually:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<your-deployment>.vercel.app/api/gmail/sync
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!isValidBearer(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await getSyncableAccounts();
  const results = [];

  for (const account of accounts) {
    try {
      results.push(await syncOneAccountNow(account));
    } catch (error) {
      unstable_rethrow(error);
      const message = error instanceof Error ? error.message : String(error);
      await updateAccountAfterSync(account.bdId, { syncError: message }).catch(() => {});
      results.push({ bdId: account.bdId, status: "error" as const, error: message });
    }
  }

  const status = results.some((r) => r.status === "error") ? 500 : 200;
  return NextResponse.json({ results }, { status });
}
