/**
 * Pure derivation of /account/email's screen state (email-sync.html screen
 * 2: needs-reconnect / connected+syncing / first-sync-in-progress). Split out from gmailConnectionState.ts (which only answers
 * "unavailable/connected/disconnected", the coarser question /account's own
 * summary row needs) so this page's 4-state fan-out stays independently
 * unit-testable with no DB.
 *
 * Precedence, most to least specific:
 *  1. `unavailable` — no server OAuth config (gmailConnectionState.ts's rule).
 *  2. `disconnected` — no row, or `status !== 'connected'`.
 *  3. `needs_reconnect` — connected but `grantedScopes` lacks
 *     `gmail.readonly` (needsReconnectForSync.ts) — this wins over a stale
 *     `syncError`/`backfillPageToken` left over from BEFORE the BD's last
 *     reconnect attempt reset the grant, since `/api/gmail/sync` already
 *     skips a pre-readonly account entirely (getSyncableAccounts), so any
 *     error/backfill columns here are necessarily stale for this state.
 *  4. `backfilling` — first-sync backfill still in progress
 *     (`backfillPageToken` not null).
 *  5. `synced` — steady-state incremental sync.
 *
 * There is deliberately NO sync-error state here. "Connected but failing to
 * sync" is not a connection state — the grant is fine and reconnecting does
 * not fix it — and a failure can coexist with backfilling or synced. It is
 * derived separately (syncHealth.ts) and rendered as an alert inside the
 * connected card.
 */
export type EmailConnectionScreenState =
  | "unavailable"
  | "disconnected"
  | "needs_reconnect"
  | "backfilling"
  | "synced";

export interface EmailConnectionScreenStateInput {
  serverConfigured: boolean;
  accountStatus: string | null | undefined;
  grantedScopes: string | null | undefined;
  backfillPageToken: string | null | undefined;
}

export function deriveEmailConnectionScreenState(
  input: EmailConnectionScreenStateInput,
  needsReconnect: (grantedScopes: string | null | undefined) => boolean,
): EmailConnectionScreenState {
  if (!input.serverConfigured) return "unavailable";
  if (input.accountStatus !== "connected") return "disconnected";
  if (needsReconnect(input.grantedScopes)) return "needs_reconnect";
  if (input.backfillPageToken) return "backfilling";
  return "synced";
}
