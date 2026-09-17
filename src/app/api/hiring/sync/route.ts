import { NextResponse } from "next/server";
import { syncAllCompanies } from "@/lib/hiring/sync";
import { isValidBearer } from "@/lib/cronAuth";

// Triggered by Vercel Cron (see vercel.json) or manually with the same
// bearer token. Not a user-facing route, so it's excluded from the Supabase
// session gate in src/lib/supabase/middleware.ts and authenticates itself
// via CRON_SECRET instead. Set CRON_SECRET in the deployment environment
// (e.g. Vercel project env vars) — this route fails closed if it's unset.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!isValidBearer(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await syncAllCompanies();
  return NextResponse.json({ results });
}
