/**
 * One account's full sync turn (token refresh -> incremental/backfill ->
 * persist the outcome) — extracted from `/api/gmail/sync/route.ts`'s
 * per-account loop body so the "Sincronizar ahora" button
 * (email-sync.html:249; src/app/(app)/account/email/connectionActions.ts)
 * runs the EXACT SAME code the 2-minute cron does, instead of a second,
 * possibly-drifting implementation. The route still owns iterating every
 * account and its own try/catch per BD; this only factors what happens
 * once inside one BD's turn — same behavior, same DB writes, callable for
 * either exactly one account (manual) or looped over many (cron).
 */
import { decryptToken } from "./crypto";
import { refreshGmailAccessToken } from "./accessToken";
import { createGmailClient } from "./client";
import { syncAccountIncremental } from "./syncAccount";
import { backfillAccountFirstSync } from "./backfillAccount";
import { BACKFILL_WINDOW_DAYS } from "./backfillWindow";
import {
  getKnownPersonsForAddresses,
  getNeverLogRules,
  getPlatformSentGmailMessageIds,
  updateAccountAfterSync,
  writeSyncedMessages,
  type SyncableAccount,
} from "./syncQueries";

export const PER_BD_BUDGET_MS = 20_000;

export interface AccountSyncOutcome {
  bdId: string;
  status: "ok" | "backfilling" | "reauth_required" | "error";
  messagesFetched?: number;
  messagesStored?: number;
  error?: string;
}

export async function syncOneAccountNow(account: SyncableAccount, now: Date = new Date()): Promise<AccountSyncOutcome> {
  const refreshToken = decryptToken(account.refreshTokenEncrypted);
  const tokenResult = await refreshGmailAccessToken(refreshToken);
  if (!tokenResult.ok) {
    await updateAccountAfterSync(account.bdId, { syncError: tokenResult.classification.message });
    return {
      bdId: account.bdId,
      status: tokenResult.classification.kind === "revoked" ? "reauth_required" : "error",
      error: tokenResult.classification.message,
    };
  }

  const client = createGmailClient(tokenResult.accessToken);
  const deps = {
    client,
    bdId: account.bdId,
    bdEmail: account.bdEmail,
    deadlineAt: now.getTime() + PER_BD_BUDGET_MS,
    getKnownPersons: getKnownPersonsForAddresses,
    getNeverLogRules: () => getNeverLogRules(account.bdId),
    getPlatformSentIds: (ids: string[]) => getPlatformSentGmailMessageIds(account.bdId, ids),
    writeMessages: (classified: Parameters<typeof writeSyncedMessages>[1]) =>
      writeSyncedMessages(account.bdId, classified),
  };

  if (!account.historyId) {
    const outcome = await backfillAccountFirstSync({
      ...deps,
      pageToken: account.backfillPageToken,
      windowDays: BACKFILL_WINDOW_DAYS,
      now,
    });
    await updateAccountAfterSync(account.bdId, {
      backfillPageToken: outcome.nextPageToken,
      ...(outcome.finalHistoryId ? { historyId: outcome.finalHistoryId } : {}),
      syncError: null,
    });
    return {
      bdId: account.bdId,
      status: "backfilling",
      messagesFetched: outcome.messagesFetched,
      messagesStored: outcome.messagesStored,
    };
  }

  const outcome = await syncAccountIncremental({ ...deps, historyId: account.historyId });

  if (outcome.status === "needs_baseline") {
    await updateAccountAfterSync(account.bdId, { historyId: null, backfillPageToken: null, syncError: null });
    return { bdId: account.bdId, status: "backfilling" };
  }

  await updateAccountAfterSync(account.bdId, {
    ...(outcome.newHistoryId ? { historyId: outcome.newHistoryId } : {}),
    syncError: null,
  });
  return {
    bdId: account.bdId,
    status: "ok",
    messagesFetched: outcome.messagesFetched,
    messagesStored: outcome.messagesStored,
  };
}
