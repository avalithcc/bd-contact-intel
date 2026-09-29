/**
 * Paths reachable without a Supabase session — the allowlist for the
 * session gate in src/lib/supabase/middleware.ts.
 *
 * /login and /auth are prefix matches BY DESIGN and unchanged: /auth/confirm
 * (the Supabase email-link landing) and any future /login/* variant must
 * stay reachable pre-session. /forgot-password is an EXACT match only —
 * a prefix match here would silently let a future route like
 * /forgot-password-admin bypass the session gate, the same failure mode
 * the CRON_ROUTES allowlist in middleware.ts guards against.
 */
export function isPublicAuthRoute(path: string): boolean {
  return (
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path === "/forgot-password"
  );
}
