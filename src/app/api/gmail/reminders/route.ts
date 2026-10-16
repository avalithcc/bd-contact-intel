import { NextResponse } from "next/server";
import { isValidBearer } from "@/lib/cronAuth";
import { getSiteUrl } from "@/lib/config/siteUrl";
import { runGmailReminders } from "@/lib/gmail/reminderRun";
import {
  claimGmailReminder,
  getReminderRows,
  markGmailReminderFailed,
  markGmailReminderSent,
} from "@/lib/gmail/reminderQueries";
import { sendDigestEmail } from "@/lib/mailer/smtpMailer";

/**
 * Weekday "connect your Gmail" reminder (gmail-reminder-email). Vercel Cron `0 12 * * 1-5` UTC (09:00 Argentina, Mon-Fri;
 * see vercel.json), or manually with the same bearer token as the other cron routes. Exempt from the Supabase
 * session gate via src/lib/auth/sessionExemptRoutes.ts. An unset CRON_SECRET never means "allow" (isValidBearer).
 *
 * Who gets what, and when, is decided by the pure planner (src/lib/gmail/reminderPlan.ts); the send runs through the same
 * SMTP mailbox as the task digest, claiming a gmail_reminder_send row BEFORE sending so a repeated run on the same Argentina
 * day never mails a BD twice. Replies go to the admin(s) via Reply-To because that mailbox cannot receive mail.
 *
 * `?dryRun=1` (still gated by CRON_SECRET) plans and reports without claiming or sending. Any failed send returns 500 so
 * Vercel's cron monitoring sees it.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "https://<deployment>.vercel.app/api/gmail/reminders?dryRun=1"
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isValidBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  const outcome = await runGmailReminders(
    { rows: await getReminderRows(), now: new Date(), siteUrl: getSiteUrl(), dryRun },
    {
      send: sendDigestEmail,
      claim: claimGmailReminder,
      markSent: (id) => markGmailReminderSent(id),
      markFailed: markGmailReminderFailed,
    },
  );

  console.log("[gmail-reminders]", JSON.stringify({ date: outcome.date, dryRun, ...outcome.summary }));
  return NextResponse.json(outcome, { status: outcome.summary.failed > 0 ? 500 : 200 });
}
