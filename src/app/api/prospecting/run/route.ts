import { handleAutoProspectingRequest, runAutoProspectingCron } from "@/lib/prospecting/cronRun";
import { realDeps } from "@/lib/prospecting/cronRunDeps";

// Daily auto-prospecting run, called by a Supabase pg_cron job (Vercel Hobby crons are daily-only and the digest owns that slot) or
// manually with the same bearer token. Not user-facing: excluded from the Supabase session gate via SESSION_EXEMPT_ROUTES
// (src/lib/auth/sessionExemptRoutes.ts) and authenticated with CRON_SECRET, exactly like /api/hiring/discover.
export const dynamic = "force-dynamic";
// One model call per draft: runAutoProspectingCron carries its own wall-clock budget (AUTO_PROSPECTING_BUDGET_MS in
// src/lib/prospecting/cronRun.ts), well under this, so the run stops cleanly and leaves the rest unconsumed.
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleAutoProspectingRequest(request, { secret: process.env.CRON_SECRET, run: () => runAutoProspectingCron(realDeps) });
}
