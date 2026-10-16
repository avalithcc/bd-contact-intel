import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { bd } from "@/db/schema";
import { LAST_SEEN_THROTTLE_MS } from "./lastSeenPolicy";

/**
 * One conditional UPDATE: stamps bd.last_seen_at only when it is null or past the throttle window. The condition is repeated
 * in SQL (not only in recordBdSeen's in-memory check) so two concurrent requests never both write. Returns whether a row changed.
 */
export async function touchLastSeen(bdId: string, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - LAST_SEEN_THROTTLE_MS);
  const rows = await db
    .update(bd)
    .set({ lastSeenAt: now })
    .where(and(eq(bd.id, bdId), or(isNull(bd.lastSeenAt), lt(bd.lastSeenAt, cutoff))))
    .returning({ id: bd.id });
  return rows.length > 0;
}
