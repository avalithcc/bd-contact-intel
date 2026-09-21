import { NextResponse } from "next/server";
import { syncAllCompanies } from "@/lib/hiring/sync";
import { classifyPendingStartups } from "@/lib/hiring/startupClassification";
import { isValidBearer } from "@/lib/cronAuth";

// Triggered by Vercel Cron (see vercel.json) or manually with the same
// bearer token. Not a user-facing route, so it's excluded from the Supabase
// session gate in src/lib/supabase/middleware.ts and authenticates itself
// via CRON_SECRET instead. Set CRON_SECRET in the deployment environment
// (e.g. Vercel project env vars) — this route fails closed if it's unset.
//
// To trigger a run manually (e.g. right after a deploy, so newly seeded
// companies get their "startup" classification without waiting for the
// next daily cron tick):
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     https://<your-deployment>.vercel.app/api/hiring/sync
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!isValidBearer(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await syncAllCompanies();

  // Startup classification (see src/lib/hiring/startupClassification.ts)
  // runs after the ATS sync, in a small capped batch, on the AI Gateway via
  // Vercel OIDC (no AI_GATEWAY_API_KEY needed in this deployment — that's
  // also why this can't be exercised from a local script). It never throws
  // out of classifyPendingStartups (a per-company failure just leaves that
  // row NULL for the next run), but this is wrapped anyway so a genuinely
  // unexpected error here (e.g. a DB hiccup on the update) can never turn a
  // successful sync into a failed cron run.
  let startupClassification;
  try {
    startupClassification = await classifyPendingStartups();
  } catch (error) {
    console.error("classifyPendingStartups failed", error);
    startupClassification = { attempted: 0, classified: 0, failed: 0, error: String(error) };
  }

  return NextResponse.json({ results, startupClassification });
}
