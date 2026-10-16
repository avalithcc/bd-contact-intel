/**
 * When getCurrentBd records "this BD was just here" (bd.last_seen_at, drizzle/0048). Pure and DB-free so it is unit-testable;
 * the write itself is src/lib/auth/lastSeenDb.ts. Throttled: getCurrentBd runs on every page and action, and the reminder
 * planner only needs day granularity, so one write per BD per 15 minutes is plenty and costs the page nothing otherwise.
 */
export const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000;

/** True when the stored value is missing or older than the throttle window. A future value (clock skew) waits. */
export function shouldTouchLastSeen(lastSeenAt: Date | null, now: Date): boolean {
  if (lastSeenAt === null) return true;
  return now.getTime() - lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS;
}

/**
 * Writes through `write` only when due, and never lets a failure reach the page: a missed update only delays a reminder
 * decision by minutes, while a thrown error would break the page for a BD who is plainly present.
 */
export async function recordBdSeen(
  row: { id: string; lastSeenAt: Date | null },
  now: Date,
  write: (bdId: string, now: Date) => Promise<void>,
): Promise<void> {
  if (!shouldTouchLastSeen(row.lastSeenAt, now)) return;
  try {
    await write(row.id, now);
  } catch (error) {
    console.error("[last-seen] update failed", error instanceof Error ? error.message : "unknown error");
  }
}
