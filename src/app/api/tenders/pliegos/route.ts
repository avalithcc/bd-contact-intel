import { handlePliegoRequest, runPliegoDownload } from "@/lib/tenders/pliegoRun";
import { realPliegoDeps } from "@/lib/tenders/pliegoRunDeps";

// Downloads the pliego PDF of the open tenders that have none, from COMPR.AR's public citizen view. Called by hand with the same
// bearer token as /api/tenders/portal (CRON_SECRET); no schedule yet. Not user-facing: excluded from the session gate via
// SESSION_EXEMPT_ROUTES. It downloads and stores only; the reading of a document stays a human action.
export const dynamic = "force-dynamic";
// runPliegoDownload carries its own wall-clock budget (PLIEGO_BUDGET_MS) well under this, so it stops cleanly between tenders.
export const maxDuration = 60;

export async function GET(request: Request) {
  return handlePliegoRequest(request, { secret: process.env.CRON_SECRET, run: () => runPliegoDownload(realPliegoDeps) });
}
