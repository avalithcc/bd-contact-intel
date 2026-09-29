import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicAuthRoute } from "@/lib/auth/publicAuthRoutes";
import { isAllowedWorkEmail } from "@/lib/auth/allowedEmail";

/**
 * Refreshes the auth session on every request and gates access:
 * unauthenticated users are redirected to /login. A session for a
 * disallowed domain or an unconfirmed email is signed out and redirected
 * the same way — this is the primary enforcement point for the
 * @avalith.net restriction (see src/lib/auth/allowedEmail.ts's doc comment
 * for why: Supabase's own signup gate + the browser-only check that used to
 * be the only line of defense here are not enough on their own).
 * src/lib/queries.ts#getCurrentBd re-checks the same two conditions as a
 * second layer, in case a route or call path ever reaches it without going
 * through this gate first.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute = isPublicAuthRoute(path);
  // Authenticated via a bearer token instead of a Supabase session — see
  // src/app/api/hiring/sync/route.ts, src/app/api/hiring/discover/route.ts
  // (CRON_SECRET) and src/app/api/leads/ingest/route.ts
  // (LEADS_INGEST_TOKEN). Exact allowlist (not a bare prefix) so future
  // routes like /api/hiring-admin don't silently bypass the session gate.
  // Each route still verifies its own token — this only stops the session
  // redirect from swallowing the request before it gets there.
  const CRON_ROUTES = ["/api/hiring/sync", "/api/hiring/discover", "/api/leads/ingest"];
  const isCronRoute = CRON_ROUTES.some(
    (route) => path === route || path.startsWith(`${route}/`),
  );

  if (!user && !isAuthRoute && !isCronRoute) {
    const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Always our own current request path — safe by construction. Still
    // re-validated with sanitizeNextPath() when it is read back on the
    // login page, since that read happens after a round trip over a URL.
    url.searchParams.set("next", requestedPath);
    return NextResponse.redirect(url);
  }

  // Same scope as the unauthenticated gate above (protected routes only —
  // never /login, /auth/* such as the confirm-link landing mid-flow, or the
  // cron bearer-token routes, none of which this check applies to). A
  // session that exists but is for a disallowed domain or an unconfirmed
  // email is treated the same as no session at all: signed out and bounced
  // to /login, never allowed to reach an app route.
  if (user && !isAuthRoute && !isCronRoute) {
    if (!isAllowedWorkEmail(user.email) || !user.email_confirmed_at) {
      // Clears the session cookies via the `cookies.setAll` adapter above,
      // which mutates the `response` closure variable — NOT the redirect
      // response built below, so those Set-Cookie headers are copied across
      // explicitly. Without this, the browser would keep the (now
      // server-invalidated) session cookie and bounce right back here.
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("error", "not_authorized");
      const redirectResponse = NextResponse.redirect(url);
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie);
      });
      return redirectResponse;
    }
  }

  return response;
}
