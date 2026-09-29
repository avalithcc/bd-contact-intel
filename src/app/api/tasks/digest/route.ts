import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { isValidBearer } from "@/lib/cronAuth";
import { getSiteUrl } from "@/lib/config/siteUrl";
import { argentinaDayBoundaries } from "@/lib/tasks/argentinaDate";
import { buildDigestEmail, groupDigestTasks } from "@/lib/tasks/digest";
import {
  claimDigestSend,
  getDigestTasksForAllBds,
  groupDigestTaskRowsByBd,
  markDigestFailed,
  markDigestSent,
} from "@/lib/tasks/digestQueries";
import { sanitizeSendError } from "@/lib/tasks/sendErrorSanitizer";
import { sendDigestEmail } from "@/lib/mailer/smtpMailer";

/**
 * Daily 08:30 America/Argentina/Buenos_Aires task-reminder digest (owner
 * decisions, task-reminders backlog). Triggered by Vercel Cron
 * (`30 11 * * *` UTC — see vercel.json) or manually with the same bearer
 * token, same convention as src/app/api/hiring/sync/route.ts. Excluded from
 * the Supabase session gate in src/lib/supabase/middleware.ts's CRON_ROUTES
 * allowlist.
 *
 * `?dryRun=1` (still gated by CRON_SECRET) renders every BD's digest
 * without claiming a task_digest_send row or sending anything — the preview
 * mode required before this cron is trusted with a real send.
 *
 * To trigger a real run manually:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<your-deployment>.vercel.app/api/tasks/digest
 * To preview without sending:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://<your-deployment>.vercel.app/api/tasks/digest?dryRun=1"
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface DigestResult {
  bdId: string;
  bdEmail: string;
  sent: boolean;
  skippedReason?: "no_open_tasks_due" | "dry_run" | "already_claimed" | "send_failed";
  subject?: string;
  counts?: { today: number; overdue: number; yesterday: number };
  error?: string;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!isValidBearer(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const now = new Date();
  const boundaries = argentinaDayBoundaries(now);
  const siteBaseUrl = getSiteUrl();

  const rows = await getDigestTasksForAllBds(boundaries.tomorrowStartUtc);
  const byBd = groupDigestTaskRowsByBd(rows);

  const results: DigestResult[] = [];

  for (const [bdId, bdTasks] of byBd) {
    const first = bdTasks[0]!;
    const groups = groupDigestTasks(bdTasks, boundaries);
    const email = buildDigestEmail({ name: first.bdName, email: first.bdEmail }, groups, siteBaseUrl);

    if (!email) {
      results.push({ bdId, bdEmail: first.bdEmail, sent: false, skippedReason: "no_open_tasks_due" });
      continue;
    }

    const counts = {
      today: groups.today.length,
      overdue: groups.overdue.length,
      yesterday: groups.yesterday.length,
    };

    if (dryRun) {
      results.push({
        bdId,
        bdEmail: first.bdEmail,
        sent: false,
        skippedReason: "dry_run",
        subject: email.subject,
        counts,
      });
      continue;
    }

    // Claim BEFORE sending — a retried or duplicated cron invocation for
    // the same (bd, Argentina date) never sends twice (idempotency rule).
    const claimedId = await claimDigestSend(bdId, boundaries.today);
    if (!claimedId) {
      results.push({ bdId, bdEmail: first.bdEmail, sent: false, skippedReason: "already_claimed" });
      continue;
    }

    try {
      await sendDigestEmail({ to: first.bdEmail, subject: email.subject, html: email.html, text: email.text });
      await markDigestSent(claimedId, {
        subject: email.subject,
        todayCount: counts.today,
        overdueCount: counts.overdue,
        yesterdayCount: counts.yesterday,
      });
      results.push({ bdId, bdEmail: first.bdEmail, sent: true, subject: email.subject, counts });
    } catch (error) {
      unstable_rethrow(error);
      const sanitized = sanitizeSendError(error);
      await markDigestFailed(claimedId, sanitized);
      results.push({ bdId, bdEmail: first.bdEmail, sent: false, skippedReason: "send_failed", error: sanitized });
    }
  }

  return NextResponse.json({ date: boundaries.today, dryRun, results });
}
