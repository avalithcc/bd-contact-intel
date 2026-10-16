/**
 * One run of the Gmail reminder cron with its side effects injected (src/app/api/gmail/reminders/route.ts wires the real SMTP
 * mailer and DB claims; tests/unit/gmailReminderRun.test.ts wires fakes, so no test can send mail). Mirrors the task-digest
 * route: plan, claim the (bd, day) row BEFORE sending, send, mark the row, never resend.
 */
import { argentinaCalendarDate } from "@/lib/tasks/argentinaDate";
import { sanitizeSendError } from "@/lib/tasks/sendErrorSanitizer";
import type { DigestSendInput } from "@/lib/mailer/smtpMailer";
import { buildOwnerNoticeEmail, buildReminderEmail } from "./reminderEmail";
import { planGmailReminders } from "./reminderPlan";
import { rowToCandidate, type ReminderRow } from "./reminderRows";

export interface ReminderRunDeps {
  send(input: DigestSendInput): Promise<void>;
  claim(bdId: string, sentOn: string, reminderNumber: number): Promise<string | null>;
  markSent(claimId: string): Promise<void>;
  markFailed(claimId: string, sanitizedError: string): Promise<void>;
}

export interface ReminderRunResult {
  bdId: string;
  bdEmail: string;
  sent: boolean;
  number?: number;
  skippedReason?: string;
  error?: string;
}

export interface ReminderRunSummary {
  sent: number;
  skipped: number;
  failed: number;
}

export async function runGmailReminders(
  input: { rows: readonly ReminderRow[]; now: Date; siteUrl: string; dryRun: boolean },
  deps: ReminderRunDeps,
): Promise<{ date: string; dryRun: boolean; summary: ReminderRunSummary; results: ReminderRunResult[] }> {
  const { rows, now, siteUrl, dryRun } = input;
  const date = argentinaCalendarDate(now);
  const admins = rows.filter((r) => r.rm_role === "admin").map((r) => r.rm_email);
  const byId = new Map(rows.map((r) => [r.rm_bd_id, r]));
  const decisions = planGmailReminders(rows.map((r) => rowToCandidate(r, now)), now);

  const results: ReminderRunResult[] = [];
  const summary: ReminderRunSummary = { sent: 0, skipped: 0, failed: 0 };
  const skip = (bdId: string, bdEmail: string, skippedReason: string) => {
    summary.skipped++;
    results.push({ bdId, bdEmail, sent: false, skippedReason });
  };

  for (const d of decisions) {
    const r = byId.get(d.bdId)!;
    if (d.action === "skip") {
      skip(d.bdId, r.rm_email, d.reason);
      continue;
    }
    if (dryRun) {
      skip(d.bdId, r.rm_email, "dry_run");
      continue;
    }
    const claimId = await deps.claim(d.bdId, date, d.number);
    if (!claimId) {
      skip(d.bdId, r.rm_email, "already_claimed");
      continue;
    }

    const email = buildReminderEmail({ name: r.rm_name }, siteUrl);
    try {
      await deps.send({ to: r.rm_email, ...email, ...(admins.length ? { replyTo: admins } : {}) });
      await deps.markSent(claimId);
      summary.sent++;
      results.push({ bdId: d.bdId, bdEmail: r.rm_email, sent: true, number: d.number });
    } catch (error) {
      const sanitized = sanitizeSendError(error);
      await deps.markFailed(claimId, sanitized);
      summary.failed++;
      results.push({ bdId: d.bdId, bdEmail: r.rm_email, sent: false, number: d.number, skippedReason: "send_failed", error: sanitized });
      continue;
    }

    if (d.notifyOwner && admins.length) {
      try {
        await deps.send({ to: admins.join(", "), ...buildOwnerNoticeEmail({ name: r.rm_name, email: r.rm_email }) });
      } catch (error) {
        summary.failed++;
        results.push({ bdId: d.bdId, bdEmail: r.rm_email, sent: false, skippedReason: "owner_notice_failed", error: sanitizeSendError(error) });
      }
    }
  }
  return { date, dryRun, summary, results };
}
