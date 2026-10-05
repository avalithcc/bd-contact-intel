/**
 * Pure decision behind scripts/rebackfill-gmail-account.ts: may this account
 * be sent back through the first-sync backfill, and what exactly changes?
 *
 * The reset is the same one syncOneAccountNow.ts already applies itself when
 * `history.list` goes stale (the `needs_baseline` branch): with
 * `history_id = NULL` the next cron turn takes the backfill path instead of
 * the incremental one. `backfill_page_token` is cleared so it starts from the
 * newest page, and `sync_error` so a stale error does not outlive the reset.
 * `last_synced_at` is deliberately untouched (every backfill turn refreshes it).
 */
import { needsReconnectForSync } from "./needsReconnectForSync";

export interface RebackfillAccountState {
  status: string;
  grantedScopes: string | null;
  hasRefreshToken: boolean;
  historyId: string | null;
  backfillPageToken: string | null;
}

export type RebackfillRefusal =
  | "no_account"
  | "not_connected"
  | "needs_reconnect"
  | "backfill_in_progress"
  | "actor_not_found";

export interface RebackfillPatch {
  historyId: null;
  backfillPageToken: null;
  syncError: null;
}

export type RebackfillDecision = { ok: true; patch: RebackfillPatch } | { ok: false; reason: RebackfillRefusal; message: string };

export interface RebackfillInput {
  account: RebackfillAccountState | null;
  /** Whether `--actor` is a real `bd` row; `null` when it was not asked (dry run without `--actor`). */
  actorExists: boolean | null;
}

function refuse(reason: RebackfillRefusal, message: string): RebackfillDecision {
  return { ok: false, reason, message };
}

export function planGmailRebackfill({ account, actorExists }: RebackfillInput): RebackfillDecision {
  if (!account) return refuse("no_account", "no email_account row matches that address");
  if (account.status !== "connected") return refuse("not_connected", `account status is '${account.status}', not 'connected'`);
  if (!account.hasRefreshToken || needsReconnectForSync(account.grantedScopes)) {
    return refuse("needs_reconnect", "the account has no refresh token or lacks the gmail.readonly scope, so the cron skips it");
  }
  if (account.backfillPageToken) return refuse("backfill_in_progress", "a backfill is already in progress (backfill_page_token is set)");
  if (!account.historyId) return refuse("backfill_in_progress", "the first backfill has not completed (history_id is null); it is already pending");
  if (actorExists === false) return refuse("actor_not_found", "--actor does not match any bd row");
  return { ok: true, patch: { historyId: null, backfillPageToken: null, syncError: null } };
}
