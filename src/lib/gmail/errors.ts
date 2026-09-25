// Classifies Google OAuth token-endpoint failures so callers can tell a
// server misconfiguration (bad client id/secret) apart from a genuinely
// revoked/expired grant, and only react to the latter by asking the user to
// reconnect. Messages built here are safe to persist to the DB and to show
// in the UI — they only echo Google's `error`/`error_description` fields,
// never the request body (which carries the client secret and tokens).

export type GmailErrorKind = "config" | "revoked" | "other";

export interface GmailErrorClassification {
  kind: GmailErrorKind;
  message: string;
}

const CONFIG_ERROR_CODES = new Set(["invalid_client", "unauthorized_client"]);
const REVOKED_ERROR_CODES = new Set(["invalid_grant"]);

export function classifyTokenRefreshError(responseBody: string): GmailErrorClassification {
  let code: string | undefined;
  let description: string | undefined;

  try {
    const parsed = JSON.parse(responseBody);
    code = typeof parsed?.error === "string" ? parsed.error : undefined;
    description =
      typeof parsed?.error_description === "string" ? parsed.error_description : undefined;
  } catch {
    // Non-JSON body from Google is unexpected; fall through as "other".
  }

  const label = code ?? "unknown_error";
  const detail = description ? `${label}: ${description}` : label;

  if (code && CONFIG_ERROR_CODES.has(code)) {
    return { kind: "config", message: `Gmail OAuth is misconfigured (${detail})` };
  }
  if (code && REVOKED_ERROR_CODES.has(code)) {
    return { kind: "revoked", message: `Gmail authorization was revoked or expired (${detail})` };
  }
  return { kind: "other", message: `Gmail token refresh failed (${detail})` };
}

// Typed error thrown by sendGmailMessage (src/lib/gmail/send.ts) so callers
// (e.g. the Contact record's sendContactEmailAction) can tell distinct
// failure causes apart instead of collapsing every Gmail failure into a
// generic "unexpected" reason. `message` values are unchanged from the
// plain Errors send.ts used to throw — the existing /leads Gmail flow reads
// and logs those strings, so they must stay byte-for-byte identical.
export type GmailSendErrorKind =
  | "not_connected"
  | "not_configured"
  | "reauth_required"
  | "temporary"
  | "send_failed";

export class GmailSendError extends Error {
  constructor(
    public readonly kind: GmailSendErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "GmailSendError";
  }
}
