/**
 * Server-side guard for "Sincronizar ahora" (email-sync.html:249;
 * fresh-review fix, 2026-10-01: the button's own client-side `busy` state
 * is not a real guard — nothing stops two tabs, or the same tab reloaded
 * mid-request, from both calling `syncEmailAccountNowAction` back to back).
 * Pure — no I/O — so the rule is unit-tested without a DB; the caller
 * (connectionActions.ts) reads `lastSyncedAt`/`backfillPageToken` off the
 * SAME row `getSyncableAccountForBd` already fetched, no extra round trip.
 */
export const SYNC_COOLDOWN_MS = 60_000;

export interface SyncCooldownInput {
  lastSyncedAt: Date | null;
  /** Non-null while the first-sync 90-day backfill hasn't finished yet (src/lib/gmail/backfillAccount.ts) — the cron already has this account's own turn in flight/imminent. */
  backfillPageToken: string | null;
  now: Date;
}

export type SyncCooldownResult = { ok: true } | { ok: false; reason: "cooldown" | "in_progress" };

export function checkSyncCooldown(input: SyncCooldownInput): SyncCooldownResult {
  // Checked first: a backfill in progress is "sync is visibly in progress"
  // regardless of how long ago `lastSyncedAt` says the last run started.
  if (input.backfillPageToken) return { ok: false, reason: "in_progress" };
  if (input.lastSyncedAt && input.now.getTime() - input.lastSyncedAt.getTime() < SYNC_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown" };
  }
  return { ok: true };
}
