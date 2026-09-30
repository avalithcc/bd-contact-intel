/**
 * Thin DB layer for buildAppShellBadgeCountsQuery — touches `@/db`, so
 * (unlike appShellBadgeCountsQuery.ts) this needs a live DATABASE_URL and is
 * not unit-tested directly (same split as every other pure-builder/DB-layer
 * pair in this codebase, e.g. src/lib/followUp/candidateQuery.ts vs.
 * queueQueries.ts).
 */
import { db } from "@/db";
import { argentinaCalendarDate, argentinaDayBoundaries, argentinaInstantDayWindow } from "@/lib/tasks/argentinaDate";
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
  // `due_at` bound (task_count) — naive 00:00-UTC scheme, unrelated to real
  // instants.
  const { tomorrowStartUtc } = argentinaDayBoundaries(now);
  // "Worked today" bound (follow_up_count) — real-instant ART midnight,
  // the SAME shared helper queueQueries.ts#workedTodayExists uses, and
  // deliberately a separate computation from the one above (fix for the
  // 2026-09-30 day-boundary bug: reusing the naive due_at boundary here
  // failed a 21:00-24:00 ART activity's own "worked today" window).
  const { fromUtc: workedTodayFrom, toUtc: workedTodayTo } = argentinaInstantDayWindow(now);
  const [row] = (await db.execute(
    buildAppShellBadgeCountsQuery({
      bdId,
      queueDate,
      tomorrowStartUtcIso: tomorrowStartUtc.toISOString(),
      workedTodayFromIso: workedTodayFrom.toISOString(),
      workedTodayToIso: workedTodayTo.toISOString(),
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
