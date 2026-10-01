/**
 * The column set written after one account's sync turn. Pure so the rule is
 * unit-tested without a DB.
 *
 * `last_synced_at` means "last SUCCESSFUL sync". It used to advance on every
 * attempt, failures included, which made a dead sync look alive: on
 * 2026-10-01 it ticked every 15 minutes for six hours while every
 * `messages.get` returned 404. A failed turn (a non-empty `syncError`) now
 * records the error and leaves the timestamp alone, so "N hours since the
 * last success" is a number a human can trust (syncHealth.ts).
 *
 * Trade-off: the manual "Sincronizar ahora" cooldown (syncCooldown.ts)
 * reads this same column, so after a failed run it no longer throttles
 * retries. That is acceptable: the button is BD-initiated and each press
 * is one bounded sync turn.
 */
export interface AfterSyncPatch {
  historyId?: string | null;
  syncError?: string | null;
  backfillPageToken?: string | null;
}

export function buildAfterSyncSet(patch: AfterSyncPatch, now: Date): AfterSyncPatch & { lastSyncedAt?: Date; updatedAt: Date } {
  const failed = typeof patch.syncError === "string" && patch.syncError.length > 0;
  return { ...patch, ...(failed ? {} : { lastSyncedAt: now }), updatedAt: now };
}
