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
 * The cron fires every 2 minutes (it was every 15 when this threshold was
 * chosen; the 60 minutes is deliberately unchanged and is now ~30 missed
 * runs, a conservative bound). One or two misses are ordinary (a cold
 * start, a Gmail 5xx, a 60s budget overrun); an hour without a success
 * means something is wrong while still catching an outage within the hour
 * instead of after a working day. Strictly greater than: exactly 60 minutes
 * is still fine.
 */
export const SYNC_STALE_AFTER_MS = 60 * 60_000;

/**
 * Grace period before an unclassified (`other`) error counts as failing.
 * `last_synced_at` is the last success and a success clears `sync_error`,
 * so "error set and no success for > 30 min" means at least two runs in a
 * row failed. A single Gmail 5xx therefore never raises the non-dismissible
 * every-page banner to BDs who can do nothing about it. Auth and config
 * errors are not transient and skip the grace.
 */
export const FAILING_GRACE_MS = 30 * 60_000;

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

  // A never-synced account is judged from when it connected, so a brand-new
  // connection waiting for its first cron tick is not flagged.
  const reference = input.lastSyncedAt ?? input.connectedAt ?? null;
  const gapMs = reference ? input.now.getTime() - reference.getTime() : 0;

  const errorKind = classifySyncError(input.syncError);
  if (errorKind && (errorKind !== "other" || gapMs > FAILING_GRACE_MS)) return { state: "failing", errorKind, sinceMs };
  // Inside the grace period an unclassified error is treated as transient.
  if (errorKind) return { state: "ok", errorKind: null, sinceMs };

  return { state: gapMs > SYNC_STALE_AFTER_MS ? "stale" : "ok", errorKind: null, sinceMs };
}
