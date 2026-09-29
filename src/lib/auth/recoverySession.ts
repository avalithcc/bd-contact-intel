/**
 * Detects a Supabase "recovery session" — one established by clicking a
 * password-recovery/invite email link (src/app/auth/confirm/route.ts calling
 * `verifyOtp`), as opposed to a normal `signInWithPassword` session — so
 * PasswordForm.tsx knows when it's safe to skip the current-password check
 * (the user arriving from a recovery link has no current password to give).
 *
 * Detection reads the `amr` (Authentication Method Reference) claim Supabase
 * bakes into every access-token JWT it issues. This is a real, documented
 * field of the SDK's own JwtPayload type — see
 * node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:
 *   "Authentication Method References. Supports both RFC-8176 compliant
 *    format (string[]) and detailed format (AMREntry[]).
 *    - String format: ['password', 'otp']
 *    - Object format: [{ method: 'password', timestamp: 1234567890 }]"
 * and GoTrueClient.js's own AMRMethods constant, whose first (and only
 * password-grant) entry is literally "password" — the value recorded for
 * every `signInWithPassword` call. This codebase's only other session-
 * establishing call is `verifyOtp` in src/app/auth/confirm/route.ts (the sole
 * call site — confirmed by `rg -n "verifyOtp" src`), whose resulting token
 * never carries "password" in amr. So "amr is present and does not include
 * 'password'" reliably distinguishes the two, without guessing at an exact
 * "recovery" method string this SDK version does not itself enumerate.
 *
 * Fails closed: any decode failure, or an access token with no amr claim at
 * all, is treated as NOT a recovery session (current-password field stays
 * required) — a normal session must never be able to trigger the bypass.
 *
 * Signature verification is deliberately NOT performed here: this only
 * drives which form fields render, not an authorization decision — every
 * actual auth call (signInWithPassword / updateUser) still goes through
 * Supabase's own server-side session validation regardless of what this
 * function returns.
 */

export interface JwtAmrEntry {
  method: string;
  timestamp?: number;
}

function base64UrlDecode(segment: string): string | null {
  try {
    return Buffer.from(segment, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/** Parses the `amr` claim out of a JWT's payload segment, normalizing both
 * the string[] and AMREntry[] formats Supabase documents. Returns null if
 * the token can't be parsed or has no amr claim. */
export function decodeJwtAmr(
  accessToken: string | null | undefined,
): JwtAmrEntry[] | null {
  if (!accessToken) return null;

  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;

  const payloadJson = base64UrlDecode(parts[1]!);
  if (payloadJson === null) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (typeof payload !== "object" || payload === null) return null;
  const amr = (payload as { amr?: unknown }).amr;
  if (!Array.isArray(amr) || amr.length === 0) return null;

  const entries: JwtAmrEntry[] = [];
  for (const entry of amr) {
    if (typeof entry === "string") {
      entries.push({ method: entry });
    } else if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { method?: unknown }).method === "string"
    ) {
      const method = (entry as { method: string }).method;
      const timestamp = (entry as { timestamp?: unknown }).timestamp;
      entries.push(
        typeof timestamp === "number" ? { method, timestamp } : { method },
      );
    } else {
      return null;
    }
  }
  return entries;
}

/** True only when the session's amr claim exists and contains no
 * "password" entry — i.e. it was never established by a normal
 * email+password sign-in. Fails closed (false) on any ambiguity. */
export function isRecoverySession(
  accessToken: string | null | undefined,
): boolean {
  const entries = decodeJwtAmr(accessToken);
  if (entries === null) return false;
  return !entries.some((entry) => entry.method === "password");
}
