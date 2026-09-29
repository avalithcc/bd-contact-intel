/**
 * Server-side source of truth for "is this a valid @avalith.net work email".
 *
 * Before this, the domain restriction lived only in the browser
 * (LoginForm.tsx), and Supabase Auth allowed anyone to sign up with the
 * public anon key using ANY email — so the check was pure UX, not
 * enforcement. This is the one place that decision is made now; every
 * caller (getCurrentBd, the session-gate middleware, LoginForm's UX check)
 * imports it instead of re-deriving the rule.
 *
 * Deliberately strict about domain matching: an email is allowed only when
 * the substring after the LAST "@" is exactly "avalith.net" (case-
 * insensitive). This rejects the tricks a naive `.endsWith("@avalith.net")`
 * or `.includes("avalith.net")` check would miss:
 *   - "x@evil.avalith.net.com"   (endsWith would still fail this one, but...)
 *   - "x@avalith.net.evil.com"   (includes/startsWith tricks)
 *   - "x@sub.avalith.net"        (subdomain — not the same mailbox domain)
 *   - "x@y@avalith.net"          (multiple "@" — most parsers take the first)
 */

const ALLOWED_DOMAIN = "avalith.net";

/** Pure predicate. Fails closed: anything not proven safe returns false. */
export function isAllowedWorkEmail(email: string | null | undefined): boolean {
  if (typeof email !== "string") return false;
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length === 0) return false;

  const atCount = (trimmed.match(/@/g) ?? []).length;
  if (atCount !== 1) return false;

  const [local, domain] = trimmed.split("@");
  if (!local || !domain) return false;

  return domain === ALLOWED_DOMAIN;
}

/** Display form of the allowed domain, e.g. for UI copy ("you@avalith.net"). */
export const ALLOWED_WORK_EMAIL_DOMAIN = `@${ALLOWED_DOMAIN}`;
