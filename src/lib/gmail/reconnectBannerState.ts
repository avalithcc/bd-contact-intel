/**
 * Pure visibility rule for the one-time reconnect banner (email-sync.html
 * screen 4; README decision 5 — persisted on `email_account.
 * reconnect_banner_dismissed_at`, not `localStorage`, so it survives a
 * device switch). Shown above every shell page while a BD's Gmail
 * connection still lacks `gmail.readonly`, until they either reconnect
 * (this rule then goes false on its own — no need to clear the dismissal
 * column) or close it (dismissReconnectBannerAction sets the column).
 */
import { needsReconnectForSync } from "./needsReconnectForSync";

export interface ReconnectBannerStateInput {
  accountStatus: string | null | undefined;
  grantedScopes: string | null | undefined;
  reconnectBannerDismissedAt: string | Date | null | undefined;
}

export function shouldShowReconnectBanner(input: ReconnectBannerStateInput): boolean {
  if (input.accountStatus !== "connected") return false;
  if (input.reconnectBannerDismissedAt) return false;
  return needsReconnectForSync(input.grantedScopes);
}
