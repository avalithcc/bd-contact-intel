import { handlePortalRequest, runPortalFetch } from "@/lib/tenders/portalRun";
import { realPortalDeps } from "@/lib/tenders/portalRunDeps";

// Refreshes the public COMPR.AR data of the open tenders. Called by a Supabase pg_cron job or by hand with the same bearer token
// as /api/prospecting/run (CRON_SECRET). Not user-facing: excluded from the session gate via SESSION_EXEMPT_ROUTES.
export const dynamic = "force-dynamic";
// runPortalFetch carries its own wall-clock budget (PORTAL_BUDGET_MS) well under this, so it stops cleanly between tenders.
export const maxDuration = 60;

export async function GET(request: Request) {
  return handlePortalRequest(request, { secret: process.env.CRON_SECRET, run: () => runPortalFetch(realPortalDeps) });
}
