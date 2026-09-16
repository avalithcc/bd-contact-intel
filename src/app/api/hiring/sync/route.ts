import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { syncAllCompanies } from "@/lib/hiring/sync";

// Triggered by Vercel Cron (see vercel.json) or manually with the same
// bearer token. Not a user-facing route, so it's excluded from the Supabase
// session gate in src/lib/supabase/middleware.ts and authenticates itself
// via CRON_SECRET instead. Set CRON_SECRET in the deployment environment
// (e.g. Vercel project env vars) — this route fails closed if it's unset.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Constant-time comparison of the bearer token against CRON_SECRET. Hashing
 * both sides first avoids leaking the secret's length via timing (raw
 * strings can differ in length, which `timingSafeEqual` rejects up front).
 */
function isValidBearer(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret || !authHeader) return false;
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const actual = createHash("sha256").update(authHeader).digest();
  return timingSafeEqual(expected, actual);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!isValidBearer(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await syncAllCompanies();
  return NextResponse.json({ results });
}
