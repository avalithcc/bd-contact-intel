import { NextResponse } from "next/server";
import { isValidBearer } from "@/lib/cronAuth";
import { expireOverdueFollowUps, EXPIRY_BATCH_CAP } from "@/lib/followUp/dropQueries";
import { argentinaCalendarDate } from "@/lib/tasks/argentinaDate";

/**
 * Daily drop of follow-ups that reached day 10 in the queue without action (follow-up-expiry). Triggered by Vercel Cron
 * (`30 5 * * *` UTC = 02:30 Argentina, after the ART day has turned over at 03:00 UTC; Hobby crons are daily-only, see
 * vercel.json) or by hand with the same bearer token. Excluded from the Supabase session gate in
 * src/lib/auth/sessionExemptRoutes.ts.
 *
 * It appends one `follow_up_expired` activity (no actor) per open item whose cycle began 10 or more Argentina days ago. Idempotent:
 * an expired item is no longer open, so a retried or doubled run writes nothing. Bounded: at most EXPIRY_BATCH_CAP per run, the next
 * daily run takes the rest. The page already hides day-10+ items, so a missed run changes nothing the BD sees.
 *
 * `?dryRun=1` (still behind CRON_SECRET) reports the count without writing. The body carries counts only, never person data.
 *   curl -H "Authorization: Bearer $CRON_SECRET" "https://<deployment>/api/follow-ups/expire?dryRun=1"
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isValidBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const today = argentinaCalendarDate(new Date());
  const expired = await expireOverdueFollowUps(today, undefined, { dryRun });
  return NextResponse.json({ dryRun, today, expired, cap: EXPIRY_BATCH_CAP });
}
