import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { isValidBearer } from "@/lib/cronAuth";
import { getSiteUrl } from "@/lib/config/siteUrl";
import { getDictionary } from "@/lib/i18n/server";
import { argentinaCalendarDate } from "@/lib/tasks/argentinaDate";
import { sanitizeSendError } from "@/lib/tasks/sendErrorSanitizer";
import { sendDigestEmail } from "@/lib/mailer/smtpMailer";
import { buildMeetingDigestEmail, selectMeetingDigests } from "@/lib/meetings/digest";
import {
  claimMeetingDigest,
  getUnconfirmedMeetingsForDigest,
  markMeetingDigestFailed,
  markMeetingDigestSent,
} from "@/lib/meetings/digestQueries";

/**
 * 18:00 America/Argentina/Buenos_Aires "meetings still unconfirmed" email (meeting-outcomes). Scheduled by Supabase pg_cron at
 * 21:00 UTC (scripts/meetings-digest-cron.sql): Vercel Hobby crons are daily-only and this one needs a fixed hour, the same
 * reason /api/gmail/sync runs from pg_cron. Same bearer token as every cron route, exempt from the session gate via
 * src/lib/auth/sessionExemptRoutes.ts; an unset CRON_SECRET never means "allow" (isValidBearer).
 *
 * Who gets an email is decided by the pure selectMeetingDigests (a BD with at least one meeting of today still unconfirmed).
 * The (BD, Argentina day) row is claimed BEFORE sending, so a repeated or late run never mails a BD twice, and nothing is
 * resent on later days. `?dryRun=1` (still bearer-gated) reports what would be sent without claiming or sending.
 * A failed send returns 500 so the scheduler sees it; a `failed` row is never retried automatically.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "https://<deployment>.vercel.app/api/meetings/digest?dryRun=1"
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface DigestResult {
  bdId: string;
  bdEmail: string;
  sent: boolean;
  skippedReason?: "dry_run" | "already_claimed" | "send_failed";
  subject?: string;
  counts: { today: number; older: number };
  error?: string;
}

export async function GET(request: Request) {
  if (!isValidBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  const now = new Date();
  const sendDate = argentinaCalendarDate(now);
  const l = (await getDictionary()).meetings;
  const siteBaseUrl = getSiteUrl();
  const plans = selectMeetingDigests(await getUnconfirmedMeetingsForDigest(now), now);

  const results: DigestResult[] = [];
  for (const plan of plans) {
    const counts = { today: plan.today.length, older: plan.olderCount };
    const email = buildMeetingDigestEmail({ name: plan.bdName, email: plan.bdEmail }, plan.today, plan.olderCount, siteBaseUrl, l, now);
    if (dryRun) {
      results.push({ bdId: plan.bdId, bdEmail: plan.bdEmail, sent: false, skippedReason: "dry_run", subject: email.subject, counts });
      continue;
    }
    const claimedId = await claimMeetingDigest(plan.bdId, sendDate, now);
    if (!claimedId) {
      results.push({ bdId: plan.bdId, bdEmail: plan.bdEmail, sent: false, skippedReason: "already_claimed", counts });
      continue;
    }
    try {
      await sendDigestEmail({ to: plan.bdEmail, subject: email.subject, html: email.html, text: email.text });
      await markMeetingDigestSent(claimedId, { subject: email.subject, todayCount: counts.today, olderCount: counts.older });
      results.push({ bdId: plan.bdId, bdEmail: plan.bdEmail, sent: true, subject: email.subject, counts });
    } catch (error) {
      unstable_rethrow(error);
      const sanitized = sanitizeSendError(error);
      await markMeetingDigestFailed(claimedId, sanitized);
      results.push({ bdId: plan.bdId, bdEmail: plan.bdEmail, sent: false, skippedReason: "send_failed", counts, error: sanitized });
    }
  }

  const failed = results.some((r) => r.skippedReason === "send_failed");
  console.log("[meetings-digest]", JSON.stringify({ date: sendDate, dryRun, planned: plans.length, sent: results.filter((r) => r.sent).length, failed }));
  return NextResponse.json({ date: sendDate, dryRun, results }, { status: failed ? 500 : 200 });
}
