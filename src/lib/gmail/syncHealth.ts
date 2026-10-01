/**
 * Is this BD's Gmail sync actually working? Deliberately separate from
 * connectionScreenState.ts.
 *
 * That module answers "which connection card does /account/email render?"
 * — mutually exclusive states about the OAuth grant (unavailable /
 * disconnected / needs_reconnect / ...). Sync health is orthogonal to the
 * grant: a connection can authenticate perfectly and still sync nothing
 * (2026-10-01: every BD's `messages.get` returned 404 for six hours while
 * the status stayed `connected`). It also needs to be read from places that
 * have no card at all — the app-shell banner and any fleet view — so it
 * lives in its own pure function instead of being one more precedence rung.
 *
 * The signal relies on `email_account.last_synced_at` meaning "last
 * SUCCESSFUL sync" (see `buildAfterSyncSet` in syncQueries.ts). A timestamp
 * that advances on failure too is indistinguishable from a healthy job.
 */

/**
 * The cron fires every 15 minutes. One or two misses are ordinary (a cold
 * start, a Gmail 5xx, a 60s budget overrun); four in a row (60 minutes)
 * means something is wrong while still catching an outage within the hour
 * instead of after a working day. Strictly greater than: exactly 60 minutes
 * is still fine.
 */
export const SYNC_STALE_AFTER_MS = 60 * 60_000;

export type SyncHealthState =
  /** Syncing normally (or a fresh connection still waiting for its first run). */
  | "ok"
  /** The last run failed: `sync_error` is set. */
  | "failing"
  /** No error recorded, but no success for longer than SYNC_STALE_AFTER_MS. */
  | "stale"
  /** Not connected — there is no sync to be healthy or unhealthy. */
  | "inactive";

/**
 * What the error means for the BD. `auth`: reconnecting fixes it. `config`:
 * the server's Google credentials are wrong, reconnecting fixes nothing, an
 * admin must act. `other`: anything else (e.g. a Gmail API failure) —
 * reconnecting is not known to help, so the UI must not suggest it.
 */
export type SyncErrorKind = "auth" | "config" | "other";

export interface SyncHealthInput {
  status: string | null | undefined;
  syncError: string | null | undefined;
  lastSyncedAt: Date | null | undefined;
  connectedAt: Date | null | undefined;
  now: Date;
}

export interface SyncHealth {
  state: SyncHealthState;
  errorKind: SyncErrorKind | null;
  /** Milliseconds since the last successful sync; null when it never succeeded. */
  sinceMs: number | null;
}

// These prefixes are produced by our own code (errors.ts, accessToken.ts);
// matching them is not parsing Gmail's output.
const AUTH_PREFIX = /^Gmail authorization was revoked/i;
const CONFIG_PREFIX = /^Gmail (OAuth is misconfigured|is not configured)/i;

export function classifySyncError(syncError: string | null | undefined): SyncErrorKind | null {
  if (!syncError || !syncError.trim()) return null;
  if (AUTH_PREFIX.test(syncError)) return "auth";
  if (CONFIG_PREFIX.test(syncError)) return "config";
  return "other";
}

export function deriveSyncHealth(input: SyncHealthInput): SyncHealth {
  if (input.status !== "connected") return { state: "inactive", errorKind: null, sinceMs: null };

  const sinceMs = input.lastSyncedAt ? Math.max(0, input.now.getTime() - input.lastSyncedAt.getTime()) : null;

  const errorKind = classifySyncError(input.syncError);
  if (errorKind) return { state: "failing", errorKind, sinceMs };

  // A never-synced account is judged from when it connected, so a brand-new
  // connection waiting for its first cron tick is not flagged.
  const reference = input.lastSyncedAt ?? input.connectedAt ?? null;
  const gapMs = reference ? input.now.getTime() - reference.getTime() : 0;
  return { state: gapMs > SYNC_STALE_AFTER_MS ? "stale" : "ok", errorKind: null, sinceMs };
}
