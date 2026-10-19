/**
 * Thin DB layer for buildAppShellBadgeCountsQuery — touches `@/db`, so
 * (unlike appShellBadgeCountsQuery.ts) this needs a live DATABASE_URL and is
 * not unit-tested directly (same split as every other pure-builder/DB-layer
 * pair in this codebase, e.g. src/lib/followUp/candidateQuery.ts vs.
 * queueQueries.ts).
 */
import { db } from "@/db";
import { argentinaCalendarDate, argentinaDayBoundaries, argentinaInstantDayWindow } from "@/lib/tasks/argentinaDate";
import { ensureTodayFollowUpQueue } from "@/lib/followUp/queueQueries";
import { readBadgeRowEnsuringQueue } from "@/lib/shell/readBadgeRowEnsuringQueue";
import { buildAppShellBadgeCountsQuery } from "@/lib/shell/appShellBadgeCountsQuery";
import { decideConnectionBanner, type ConnectionBannerDecision } from "@/lib/gmail/connectionBanner";
import { gmailAttentionCount, type GmailFleetAccountJson } from "@/lib/gmail/fleetAttention";

export interface AppShellBadgeCounts {
  taskCount: number;
  followUpCount: number;
  /** Open absorption proposals, team-wide (not per-BD). */
  absorptionCount: number;
  /** Open duplicate candidates, team-wide; always 0 for non-admins (query skipped). */
  duplicateCount: number;
  /** This BD's Sequences with at least one member still in progress (13.6). */
  sequenceCount: number;
  /** This BD's scheduled emails that are scheduled, on hold or failed. */
  scheduledCount: number;
  /** This BD's meetings waiting for an outcome ("Por confirmar"); the sidebar "Reuniones" pill. */
  meetingPendingCount: number;
  /** BDs that need attention on /admin/gmail (the admin sidebar pill); always 0 for non-admins (the subquery is skipped). */
  gmailAttentionCount: number;
  /** Which Gmail banner the shell shows, if any — see connectionBanner.ts. */
  connectionBanner: ConnectionBannerDecision | null;
}

interface EmailAccountBannerState {
  status: string | null;
  grantedScopes: string | null;
  syncError: string | null;
  // json_build_object serializes timestamptz as ISO text, never a Date.
  lastSyncedAt: string | null;
  connectedAt: string | null;
}

/** (bd, ART day) pairs this server instance already tried to build; see readBadgeRowEnsuringQueue.ts. */
const queueBuildAttempted = new Set<string>();

const toDate = (iso: string | null | undefined): Date | null => (iso ? new Date(iso) : null);

/**
 * ONE round trip for the sidebar badges AND the reconnect banner flag
 * (AppLayout) — see appShellBadgeCountsQuery.ts's doc comment for why this
 * replaced two separate sequential queries, and its own comment on the
 * `email_account_banner_state` column for why the reconnect banner rides
 * along here instead of a second query.
 */
export async function getAppShellBadgeCounts(bdId: string, now: Date, isAdmin = false): Promise<AppShellBadgeCounts> {
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
  const readRow = async () => {
    const [r] = (await db.execute(
      buildAppShellBadgeCountsQuery({
        bdId,
        queueDate,
        tomorrowStartUtcIso: tomorrowStartUtc.toISOString(),
        workedTodayFromIso: workedTodayFrom.toISOString(),
        workedTodayToIso: workedTodayTo.toISOString(),
        nowIso: now.toISOString(),
        isAdmin,
      }),
    )) as unknown as {
      task_count: number;
      follow_up_count: number;
      absorption_count: number;
      duplicate_count: number;
      sequence_count: number;
      scheduled_count: number;
      meeting_pending_count: number;
      queue_built: boolean;
      email_account_banner_state: EmailAccountBannerState | null;
      gmail_fleet_accounts: GmailFleetAccountJson[] | null;
    }[];
    // An empty result cannot happen (scalar subqueries), but keep the old
    // `row?.` tolerance rather than throwing in the shell.
    return r ?? { task_count: 0, follow_up_count: 0, absorption_count: 0, duplicate_count: 0, sequence_count: 0, scheduled_count: 0, meeting_pending_count: 0, queue_built: true, email_account_banner_state: null, gmail_fleet_accounts: null };
  };
  // F5: build today's queue on the first page of the day — see
  // readBadgeRowEnsuringQueue.ts for the rationale and the behaviour change.
  const row = await readBadgeRowEnsuringQueue({
    read: readRow,
    ensure: () => ensureTodayFollowUpQueue(bdId, now),
    attemptKey: `${bdId}:${queueDate}`,
    bdId,
    attempted: queueBuildAttempted,
  });
  const bannerState = row?.email_account_banner_state ?? null;
  const connectionBanner = decideConnectionBanner({
    account: bannerState && {
      status: bannerState.status,
      grantedScopes: bannerState.grantedScopes,
      syncError: bannerState.syncError,
      lastSyncedAt: toDate(bannerState.lastSyncedAt),
      connectedAt: toDate(bannerState.connectedAt),
    },
    now,
  });
  return {
    taskCount: Number(row?.task_count ?? 0),
    followUpCount: Number(row?.follow_up_count ?? 0),
    absorptionCount: Number(row?.absorption_count ?? 0),
    duplicateCount: Number(row?.duplicate_count ?? 0),
    sequenceCount: Number(row?.sequence_count ?? 0),
    scheduledCount: Number(row?.scheduled_count ?? 0),
    meetingPendingCount: Number(row?.meeting_pending_count ?? 0),
    gmailAttentionCount: gmailAttentionCount(row?.gmail_fleet_accounts, now),
    connectionBanner,
  };
}
