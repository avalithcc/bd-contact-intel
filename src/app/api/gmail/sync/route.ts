import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { isValidBearer } from "@/lib/cronAuth";
import { decryptToken } from "@/lib/gmail/crypto";
import { refreshGmailAccessToken } from "@/lib/gmail/accessToken";
import { createGmailClient } from "@/lib/gmail/client";
import { syncAccountIncremental } from "@/lib/gmail/syncAccount";
import {
  getKnownPersonsForAddresses,
  getNeverLogRules,
  getPlatformSentGmailMessageIds,
  getSyncableAccounts,
  updateAccountAfterSync,
  writeSyncedMessages,
} from "@/lib/gmail/syncQueries";

/**
 * Polls every connected, readonly-scoped BD's Gmail inbox for CRM-matched
 * mail (email-sync brief). Triggered by Supabase `pg_cron` + `pg_net` every
 * 15 minutes (see scripts/gmail-sync-cron.sql, run once by the orchestrator
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
 * An account with no stored `historyId` yet needs the first-sync backfill
 * (email-sync brief slice 4) — this route flags it (`needs_baseline`) but
 * does not perform that pull itself yet.
 *
 * To trigger a real run manually:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<your-deployment>.vercel.app/api/gmail/sync
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER_BD_BUDGET_MS = 20_000;

interface AccountSyncResult {
  bdId: string;
  status: "ok" | "needs_baseline" | "reauth_required" | "error";
  messagesFetched?: number;
  messagesStored?: number;
  error?: string;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!isValidBearer(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await getSyncableAccounts();
  const results: AccountSyncResult[] = [];

  for (const account of accounts) {
    try {
      if (!account.historyId) {
        results.push({ bdId: account.bdId, status: "needs_baseline" });
        continue;
      }

      const refreshToken = decryptToken(account.refreshTokenEncrypted);
      const tokenResult = await refreshGmailAccessToken(refreshToken);
      if (!tokenResult.ok) {
        await updateAccountAfterSync(account.bdId, { syncError: tokenResult.classification.message });
        results.push({
          bdId: account.bdId,
          status: tokenResult.classification.kind === "revoked" ? "reauth_required" : "error",
          error: tokenResult.classification.message,
        });
        continue;
      }

      const client = createGmailClient(tokenResult.accessToken);
      const outcome = await syncAccountIncremental({
        client,
        bdId: account.bdId,
        bdEmail: account.bdEmail,
        historyId: account.historyId,
        deadlineAt: Date.now() + PER_BD_BUDGET_MS,
        getKnownPersons: getKnownPersonsForAddresses,
        getNeverLogRules: () => getNeverLogRules(account.bdId),
        getPlatformSentIds: (ids) => getPlatformSentGmailMessageIds(account.bdId, ids),
        writeMessages: (classified) => writeSyncedMessages(account.bdId, classified),
      });

      if (outcome.status === "needs_baseline") {
        await updateAccountAfterSync(account.bdId, { historyId: null, syncError: null });
        results.push({ bdId: account.bdId, status: "needs_baseline" });
        continue;
      }

      await updateAccountAfterSync(account.bdId, {
        ...(outcome.newHistoryId ? { historyId: outcome.newHistoryId } : {}),
        syncError: null,
      });
      results.push({
        bdId: account.bdId,
        status: "ok",
        messagesFetched: outcome.messagesFetched,
        messagesStored: outcome.messagesStored,
      });
    } catch (error) {
      unstable_rethrow(error);
      const message = error instanceof Error ? error.message : String(error);
      await updateAccountAfterSync(account.bdId, { syncError: message }).catch(() => {});
      results.push({ bdId: account.bdId, status: "error", error: message });
    }
  }

  const status = results.some((r) => r.status === "error") ? 500 : 200;
  return NextResponse.json({ results }, { status });
}
