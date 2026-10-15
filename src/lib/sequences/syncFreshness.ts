/**
 * Is reply detection recent enough to trust before releasing a reminder? Pure. A null `lastSyncedAt` (the account never
 * synced) is STALE: "unknown" must never read as "fresh", or a reminder could go to someone who already replied.
 */
export function isSyncFreshEnough(input: { lastSyncedAt: Date | null; now: Date; staleAfterMs: number }): boolean {
  if (!input.lastSyncedAt) return false;
  return input.now.getTime() - input.lastSyncedAt.getTime() <= input.staleAfterMs;
}
