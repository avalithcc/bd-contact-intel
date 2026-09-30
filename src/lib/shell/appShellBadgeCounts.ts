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
import { shouldShowReconnectBanner } from "@/lib/gmail/reconnectBannerState";

export interface AppShellBadgeCounts {
  taskCount: number;
  followUpCount: number;
  /** email-sync.html screen 4 — see reconnectBannerState.ts. */
  needsReconnectBanner: boolean;
}

interface EmailAccountBannerState {
  status: string | null;
  grantedScopes: string | null;
  dismissedAt: string | null;
}

/**
 * ONE round trip for the sidebar badges AND the reconnect banner flag
 * (AppLayout) — see appShellBadgeCountsQuery.ts's doc comment for why this
 * replaced two separate sequential queries, and its own comment on the
 * `email_account_banner_state` column for why the reconnect banner rides
 * along here instead of a second query.
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
  )) as unknown as {
    task_count: number;
    follow_up_count: number;
    email_account_banner_state: EmailAccountBannerState | null;
  }[];
  const bannerState = row?.email_account_banner_state ?? null;
  return {
    taskCount: Number(row?.task_count ?? 0),
    followUpCount: Number(row?.follow_up_count ?? 0),
    needsReconnectBanner: shouldShowReconnectBanner({
      accountStatus: bannerState?.status ?? null,
      grantedScopes: bannerState?.grantedScopes ?? null,
      reconnectBannerDismissedAt: bannerState?.dismissedAt ?? null,
    }),
  };
}
