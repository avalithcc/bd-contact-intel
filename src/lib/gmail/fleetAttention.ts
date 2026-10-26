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

/** Never throws: the shell calls this on every admin page, so bad data must cost a pill, not the page. */
export function gmailAttentionCount(rows: readonly GmailFleetAccountJson[] | null | undefined, now: Date): number {
  try {
    return countRows(rows, now);
  } catch (error) {
    console.error("[gmail-fleet] could not classify the Gmail accounts for the sidebar pill; showing none", error);
    return 0;
  }
}

/**
 * The one json-row to FleetAccount mapping: the pill counts with it, and the unit cross-check feeds the fleet screen's
 * builder with it, so both sides of that test start from one fixture.
 *
 * `hasCursor` and `backfilling` are hardcoded because the badge statement does not read them (appShellBadgeCountsQuery.ts
 * joins only bd and email_account). That is safe, and checked rather than assumed: the ONLY consumer of either field is
 * fleetText.ts's cursor LINE — display text. `classifyAccount` never reads them, so they cannot change whether an account
 * counts as needing attention, and the pill cannot disagree with the fleet screen over them. If a future classifier starts
 * reading either one, this mapping becomes a real divergence and these two values must come from the query instead.
 */
export function fleetAccountFromJson(r: GmailFleetAccountJson): FleetAccount | null {
  return r.has
    ? {
        status: r.status,
        grantedScopes: r.grantedScopes,
        syncError: r.syncError,
        lastSyncedAt: toDate(r.lastSyncedAt),
        connectedAt: toDate(r.connectedAt),
        hasCursor: true,
        backfilling: false,
      }
    : null;
}

function countRows(rows: readonly GmailFleetAccountJson[] | null | undefined, now: Date): number {
  return countAttention((rows ?? []).map(fleetAccountFromJson), now);
}
