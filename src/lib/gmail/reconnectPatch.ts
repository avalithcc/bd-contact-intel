/**
 * Columns the OAuth callback resets when a BD (re)connects. A fresh grant
 * invalidates the previous sync verdict: without this, a BD whose auth was
 * revoked reconnects successfully and is immediately shown the old danger
 * alert and global banner (stale `sync_error`), and a pre-readonly account
 * that the cron skipped (null or ancient `last_synced_at`) reads as stale
 * the moment it reconnects. `connectedAt` restarts the staleness clock
 * (syncHealth.ts judges a never-synced account from it) and
 * `lastSyncedAt: null` makes "last success" honest for the new grant.
 */
export function buildReconnectSyncReset(now: Date): { syncError: null; lastSyncedAt: null; connectedAt: Date } {
  return { syncError: null, lastSyncedAt: null, connectedAt: now };
}
