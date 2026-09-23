import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the auth session on every request and gates access:
 * unauthenticated users are redirected to /login.
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
  const isAuthRoute = path.startsWith("/login") || path.startsWith("/auth");
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
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
