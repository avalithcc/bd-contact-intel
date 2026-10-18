/**
 * The admin sidebar pill of "Estado de Gmail": how many BDs need attention. The shell's one badge statement returns a light
 * json row per monitored BD (appShellBadgeCountsQuery.ts: bd left join email_account, no other table); this turns it into the
 * count with the SAME classifier the fleet screen uses (fleetView.ts), so the pill and the "Necesitan atención" filter can
 * never disagree. Pure.
 */
import { countAttention, type FleetAccount } from "./fleetView";

/** One element of the `gmail_fleet_accounts` json column. json_agg serializes timestamptz as ISO text. */
export interface GmailFleetAccountJson {
  /** false: the BD has no email_account row (never connected). */
  has: boolean;
  status: string | null;
  grantedScopes: string | null;
  syncError: string | null;
  lastSyncedAt: string | null;
  connectedAt: string | null;
}

const toDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

export function gmailAttentionCount(rows: readonly GmailFleetAccountJson[] | null | undefined, now: Date): number {
  const accounts = (rows ?? []).map(
    (r): FleetAccount | null =>
      r.has
        ? {
            status: r.status,
            grantedScopes: r.grantedScopes,
            syncError: r.syncError,
            lastSyncedAt: toDate(r.lastSyncedAt),
            connectedAt: toDate(r.connectedAt),
            hasCursor: true,
            backfilling: false,
          }
        : null,
  );
  return countAttention(accounts, now);
}
