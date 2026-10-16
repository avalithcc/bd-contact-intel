/**
 * Routes that skip the Supabase session gate in src/lib/supabase/middleware.ts because their caller has no session:
 * a cron sending a bearer token, an ingest webhook, or (for /api/unsubscribe) a recipient clicking a link in an email.
 * Each route still authenticates its own caller; this only stops the session redirect from swallowing the request first.
 *
 * Exact match or slash prefix, never a bare prefix, so a future /api/unsubscribe-admin or /api/hiring-admin does not
 * silently bypass the gate.
 */
export const SESSION_EXEMPT_ROUTES: readonly string[] = [
  "/api/hiring/sync",
  "/api/hiring/discover",
  "/api/leads/ingest",
  "/api/tasks/digest",
  "/api/gmail/sync",
  "/api/gmail/reminders",
  "/api/owners/recompute",
  "/api/sequences/run",
  "/api/unsubscribe",
];

export function isSessionExemptPath(path: string): boolean {
  return SESSION_EXEMPT_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}
