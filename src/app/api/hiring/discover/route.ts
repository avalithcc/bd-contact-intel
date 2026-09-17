import { NextResponse } from "next/server";
import { runDiscovery } from "@/lib/hiring/discovery";
import { isValidBearer } from "@/lib/cronAuth";

// Triggered by Vercel Cron (see vercel.json) or manually with the same
// bearer token. Not a user-facing route, excluded from the Supabase
// session gate in src/lib/supabase/middleware.ts (same CRON_ROUTES
// allowlist as /api/hiring/sync) and authenticated via CRON_SECRET instead.
export const dynamic = "force-dynamic";
// Higher than /api/hiring/sync's 60s: discovery probes many more
// (company x ats x slug-variant) combinations per run. Requires a Vercel
// plan whose function timeout ceiling covers this — see this change's
// verification notes for the open risk if the deployment is on a plan
// capped below it. runDiscovery's own wall-clock budget (see
// DEFAULT_MAX_DURATION_MS in src/lib/hiring/discovery.ts) is set well
// under this so the discovery_run row is always finalized before the
// platform would kill the function.
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!isValidBearer(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runDiscovery();
  return NextResponse.json(result);
}
