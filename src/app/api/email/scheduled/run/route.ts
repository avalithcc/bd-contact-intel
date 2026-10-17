import { NextResponse } from "next/server";
import { isValidBearer } from "@/lib/cronAuth";
import { dispatchScheduledEmails } from "@/lib/scheduledEmail/dispatch";
import { claimDue, countDue, holdReplied, markCancelled, markFailed, markSent, releaseClaimed, sweepStale } from "@/lib/scheduledEmail/queries";
import { sendScheduledEmail } from "@/lib/scheduledEmail/send";
import { listSuppressionRules } from "@/lib/sequences/suppressionQueries";

/**
 * Scheduled-send dispatcher. Called every minute by Supabase pg_cron (see openspec/changes/scheduled-send/pg_cron.sql);
 * Vercel Hobby crons are daily-only. Exempt from the session gate via src/lib/auth/sessionExemptRoutes.ts and gated by
 * the same CRON_SECRET bearer as the other cron routes (an unset secret never allows).
 *
 * `?dryRun=1` (still gated) only counts what is due: it claims, holds, sweeps and sends nothing. A failed send does not
 * fail the request: the row carries the failure and the BD is told in the app; the run itself succeeded.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "https://<deployment>.vercel.app/api/email/scheduled/run?dryRun=1"
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isValidBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const summary = await dispatchScheduledEmails(
    { holdReplied, claimDue, countDue, sweepStale, markSent, markFailed, markCancelled, releaseClaimed, loadSuppression: listSuppressionRules, send: sendScheduledEmail },
    { dryRun },
  );
  console.log("[scheduled-email]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
