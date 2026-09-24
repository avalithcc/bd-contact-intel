import crypto from "crypto";

// httpOnly CSRF-state cookie for the Gmail OAuth handshake. Scoped to the
// oauth routes only and short-lived — it only needs to survive the redirect
// round trip to Google and back.
export const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";
export const GMAIL_OAUTH_STATE_COOKIE_PATH = "/api/gmail/oauth";
export const GMAIL_OAUTH_STATE_MAX_AGE_SECONDS = 600; // 10 minutes

/** Generates a cryptographically random nonce for the OAuth `state` param. */
export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Constant-time comparison of the state cookie set in oauth/start against
 * the `state` query param Google echoes back to oauth/callback. Missing
 * values are always a mismatch. Length is checked before calling
 * `timingSafeEqual`, which throws on differing lengths rather than
 * returning false.
 */
export function statesMatch(
  cookieState: string | undefined | null,
  queryState: string | undefined | null,
): boolean {
  if (!cookieState || !queryState) return false;
  const a = Buffer.from(cookieState, "utf8");
  const b = Buffer.from(queryState, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
