/**
 * Exchanges a stored refresh token for a fresh Gmail access token — the same
 * token-endpoint call src/lib/gmail/send.ts makes, factored out so
 * /api/gmail/sync can reuse the same revoked/config-error classification
 * without duplicating the fetch. (send.ts keeps its own inline copy for now
 * — out of scope for this branch to avoid touching the send path.)
 */
import { classifyTokenRefreshError, type GmailErrorClassification } from "./errors";
import { getGmailOAuthConfig } from "./config";

export type AccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; classification: GmailErrorClassification };

export async function refreshGmailAccessToken(refreshToken: string): Promise<AccessTokenResult> {
  const configResult = getGmailOAuthConfig();
  if (!configResult.ok) {
    return {
      ok: false,
      classification: {
        kind: "config",
        message: `Gmail is not configured on the server (missing: ${configResult.missing.join(", ")}).`,
      },
    };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: configResult.config.clientId,
      client_secret: configResult.config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!res.ok) {
    return { ok: false, classification: classifyTokenRefreshError(await res.text()) };
  }
  const { access_token } = await res.json();
  return { ok: true, accessToken: access_token };
}
