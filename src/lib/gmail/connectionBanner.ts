/**
 * The single source of truth for "which Gmail banner, if any, does the shell
 * show?" (gmail-reconnect-banner mockup). Replaces the two components that
 * used to decide for themselves (ReconnectBanner + SyncHealthBanner).
 *
 * Red (`danger`): the BD's mail has stopped entering the CRM and only the BD
 * can fix it, by reconnecting — disconnected, permission expired/revoked, or
 * missing `gmail.readonly`. Amber (`warn`): stale (usually fixes itself), and
 * the failures reconnecting does not fix (`config`, or `other` once past the
 * grace period in syncHealth.ts). No decision is dismissible, by design: the
 * old persisted dismissal is gone.
 */
import type { Locale } from "@/lib/i18n/locales";
import { needsReconnectForSync } from "./needsReconnectForSync";
import { deriveSyncHealth } from "./syncHealth";

export interface ConnectionBannerAccount {
  status: string | null | undefined;
  grantedScopes: string | null | undefined;
  syncError: string | null | undefined;
  lastSyncedAt: Date | null | undefined;
  connectedAt: Date | null | undefined;
}

export interface ConnectionBannerInput {
  /** The BD's `email_account` row; null when the BD never started connecting. */
  account: ConnectionBannerAccount | null;
  now: Date;
}

export type ConnectionBannerDecision =
  | { tone: "danger"; reason: "disconnected" }
  | { tone: "danger"; reason: "missing_scope" }
  /** `sinceMs`: time since the last successful sync, null when it never succeeded. */
  | { tone: "danger"; reason: "expired"; sinceMs: number | null }
  | { tone: "warn"; reason: "failing" | "stale" };

export function decideConnectionBanner({ account, now }: ConnectionBannerInput): ConnectionBannerDecision | null {
  if (!account) return { tone: "danger", reason: "disconnected" };
  // send.ts flips the row to "error" (the schema also reserves "revoked") when
  // Google rejects the refresh token: that is the mockup's "permission expired
  // or revoked", not a BD-initiated disconnect ("disconnected").
  if (account.status === "error" || account.status === "revoked") {
    const sinceMs = account.lastSyncedAt ? Math.max(0, now.getTime() - account.lastSyncedAt.getTime()) : null;
    return { tone: "danger", reason: "expired", sinceMs };
  }
  if (account.status !== "connected") return { tone: "danger", reason: "disconnected" };
  // A pre-readonly connection is skipped by the sync cron, so its health
  // signals are meaningless; this rule covers it.
  if (needsReconnectForSync(account.grantedScopes)) return { tone: "danger", reason: "missing_scope" };

  const health = deriveSyncHealth({ ...account, now });
  if (health.state === "failing") {
    return health.errorKind === "auth"
      ? { tone: "danger", reason: "expired", sinceMs: health.sinceMs }
      : { tone: "warn", reason: "failing" };
  }
  if (health.state === "stale") return { tone: "warn", reason: "stale" };
  return null;
}

/** "hace 3 horas" / "3 hours ago" — minutes under an hour, hours under two days, else days. */
export function formatSince(ms: number, locale: Locale): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return rtf.format(-Math.max(1, minutes), "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return rtf.format(-hours, "hour");
  return rtf.format(-Math.floor(hours / 24), "day");
}
