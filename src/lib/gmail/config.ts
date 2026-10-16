// Central place to read the Gmail OAuth/env configuration. Centralizing this
// means callers fail fast with a clear error instead of building requests
// with "undefined" client ids/secrets baked in.

export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKey: string;
}

export type GmailOAuthConfigResult =
  | { ok: true; config: GmailOAuthConfig }
  | { ok: false; missing: string[] };

const REQUIRED_VARS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GMAIL_TOKEN_ENCRYPTION_KEY",
] as const;

/**
 * Reads the Gmail OAuth env vars. Reports which ones are missing by name
 * only (never by value) so callers can redirect to a clear "not configured"
 * state instead of sending Google a request with literal "undefined" params.
 */
export function getGmailOAuthConfig(): GmailOAuthConfigResult {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) return { ok: false, missing: [...missing] };

  return {
    ok: true,
    config: {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
      tokenEncryptionKey: process.env.GMAIL_TOKEN_ENCRYPTION_KEY!,
    },
  };
}

/**
 * Shell guard: is the Gmail OAuth config usable so the banner link can land on
 * a real card? When it is not, every Gmail banner is hidden, so say so in the
 * server log, once per server instance (the layout runs on every page view).
 * Names only, never values.
 */
let warnedMissingConfig = false;

export function gmailConfigOkOrWarnOnce(
  read: () => GmailOAuthConfigResult = getGmailOAuthConfig,
  warn: (message: string) => void = (m) => console.error(m),
): boolean {
  const result = read();
  if (result.ok) return true;
  if (!warnedMissingConfig) {
    warnedMissingConfig = true;
    warn(`[gmail] OAuth config missing (${result.missing.join(", ")}): Gmail reconnect/sync banners are hidden for every BD`);
  }
  return false;
}

/** Test hook: forget that the warning was already emitted. */
export function resetGmailConfigWarning(): void {
  warnedMissingConfig = false;
}
