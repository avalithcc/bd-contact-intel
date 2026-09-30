/**
 * Thin DB layer for buildAppShellBadgeCountsQuery — touches `@/db`, so
 * (unlike appShellBadgeCountsQuery.ts) this needs a live DATABASE_URL and is
 * not unit-tested directly (same split as every other pure-builder/DB-layer
 * pair in this codebase, e.g. src/lib/followUp/candidateQuery.ts vs.
 * queueQueries.ts).
 */
import { db } from "@/db";
import { argentinaCalendarDate, argentinaDayBoundaries } from "@/lib/tasks/argentinaDate";
import { buildAppShellBadgeCountsQuery } from "@/lib/shell/appShellBadgeCountsQuery";

export interface AppShellBadgeCounts {
  taskCount: number;
  followUpCount: number;
}

/**
 * ONE round trip for both sidebar badges (AppLayout) — see
 * appShellBadgeCountsQuery.ts's doc comment for why this replaced two
 * separate sequential queries.
 */
export async function getAppShellBadgeCounts(bdId: string, now: Date): Promise<AppShellBadgeCounts> {
  const queueDate = argentinaCalendarDate(now);
  const { todayStartUtc, tomorrowStartUtc } = argentinaDayBoundaries(now);
  const [row] = (await db.execute(
    buildAppShellBadgeCountsQuery({
      bdId,
      queueDate,
      tomorrowStartUtcIso: tomorrowStartUtc.toISOString(),
      todayStartUtcIso: todayStartUtc.toISOString(),
    }),
  )) as unknown as { task_count: number; follow_up_count: number }[];
  return {
    taskCount: Number(row?.task_count ?? 0),
    followUpCount: Number(row?.follow_up_count ?? 0),
  };
}
