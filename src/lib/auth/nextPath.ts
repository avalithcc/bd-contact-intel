/**
 * Validates the `next` redirect target carried through the login flow
 * (middleware → /login?next=... → post-signIn redirect) and the Supabase
 * recovery-link landing (/auth/confirm?next=...).
 *
 * The value always arrives over a URL, which an attacker can craft (e.g. a
 * phishing link to `/login?next=https://evil.com`), so it must be proven to
 * be a same-origin relative path before it is ever used as a redirect
 * target. Only an exact allowlist of shapes is accepted — everything else
 * falls back to a safe default.
 */

const DEFAULT_NEXT_PATH = "/";

function hasUnsafePrefix(value: string): boolean {
  if (/^\s/.test(value)) return true; // whitespace-prefixed (incl. tab/newline)
  if (!value.startsWith("/")) return true; // not relative to this origin
  if (value.startsWith("//")) return true; // protocol-relative
  if (value.startsWith("/\\")) return true; // backslash trick some browsers treat as "//"
  return false;
}

/** Pure predicate — true only for a same-origin relative path we trust as a redirect target. */
export function isSafeNextPath(raw: string): boolean {
  if (typeof raw !== "string" || raw.length === 0) return false;
  if (hasUnsafePrefix(raw)) return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return false; // malformed percent-encoding
  }
  if (decoded !== raw && hasUnsafePrefix(decoded)) return false;

  try {
    const base = "http://localhost";
    const resolved = new URL(decoded, base);
    if (resolved.origin !== base) return false;
  } catch {
    return false;
  }

  return true;
}

/** Returns `raw` unchanged if safe, otherwise `fallback` (default "/"). */
export function sanitizeNextPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_NEXT_PATH,
): string {
  if (raw != null && isSafeNextPath(raw)) return raw;
  return fallback;
}
