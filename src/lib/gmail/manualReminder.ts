/**
 * The admin's "Enviar recordatorio" on the Gmail fleet screen: sends the next "connect your Gmail" reminder of one BD now,
 * through the same runner as the weekday cron (reminderRun.ts: claim the (bd, day) row, send, mark it), so it counts in the
 * 3-reminder series and obeys the same guards (never an admin, a BD with reminders off, or a healthy Gmail). Side effects are
 * injected; the server action wires the real mailer and DB.
 *
 * It is consequential, so it is audited: the audit row (actor = the admin, target = the BD) is written in the SAME step that
 * marks the claim sent (`markSentAudited`), after the mail is out, never for a refused or failed send.
 */
import { assertAdminRole } from "@/lib/auth/adminRole";
import type { DigestSendInput } from "@/lib/mailer/smtpMailer";
import { runGmailReminders } from "./reminderRun";
import type { ReminderRow } from "./reminderRows";

export const MANUAL_REMINDER_AUDIT_ACTION = "gmail_reminder_manual";

export interface ManualReminderAudit {
  actorBdId: string;
  bdId: string;
  number: number;
  sentOn: string;
}

export interface ManualReminderDeps {
  readRows(): Promise<ReminderRow[]>;
  send(input: DigestSendInput): Promise<void>;
  claim(bdId: string, sentOn: string, reminderNumber: number): Promise<string | null>;
  /** Marks the claim sent AND writes the audit row, atomically. */
  markSentAudited(claimId: string, audit: ManualReminderAudit): Promise<void>;
  /** Marks the claim sent without the audit row: the fallback when the audited step fails after the mail went out. */
  markSent(claimId: string): Promise<void>;
  markFailed(claimId: string, sanitizedError: string): Promise<void>;
}

export type ManualReminderResult =
  | { ok: true; number: number }
  | { ok: false; reason: "not_found" | "not_eligible" | "already_sent_today" | "send_failed" }
  /** The mail WAS sent but its audit row could not be written: not a success, and the admin must be told. */
  | { ok: false; reason: "audit_failed"; number: number };

export async function sendManualReminder(
  input: { admin: { id: string; role: string }; bdId: string; now: Date; siteUrl: string },
  deps: ManualReminderDeps,
): Promise<ManualReminderResult> {
  assertAdminRole(input.admin);
  const rows = await deps.readRows();
  if (!rows.some((r) => r.rm_bd_id === input.bdId)) return { ok: false, reason: "not_found" };

  let claimed: { number: number; sentOn: string } | null = null;
  let auditFailed = false;
  const outcome = await runGmailReminders(
    { rows, now: input.now, siteUrl: input.siteUrl, dryRun: false, onlyBdId: input.bdId },
    {
      send: deps.send,
      claim: async (bdId, sentOn, number) => {
        const id = await deps.claim(bdId, sentOn, number);
        if (id) claimed = { number, sentOn };
        return id;
      },
      markSent: async (claimId) => {
        const audit = { actorBdId: input.admin.id, bdId: input.bdId, number: claimed!.number, sentOn: claimed!.sentOn };
        try {
          await deps.markSentAudited(claimId, audit);
        } catch (error) {
          // The mail is out and cannot be recalled. The audited step is one transaction, so nothing was written: still record
          // the claim as sent, or tomorrow's cron would send the same reminder number again.
          auditFailed = true;
          console.error("[gmail-reminders] manual reminder SENT but the audit row could not be written; check audit_log before resending", JSON.stringify({ bdId: input.bdId, actorBdId: input.admin.id, number: audit.number, sentOn: audit.sentOn }), error);
          try {
            await deps.markSent(claimId);
          } catch (markError) {
            console.error("[gmail-reminders] manual reminder SENT but its claim could not be marked sent either; the cron may resend this number", JSON.stringify({ bdId: input.bdId, number: audit.number }), markError);
          }
        }
      },
      markFailed: deps.markFailed,
    },
  );

  const mine = outcome.results.filter((r) => r.bdId === input.bdId);
  const delivered = mine.find((r) => r.sent && r.number !== undefined);
  if (delivered && auditFailed) return { ok: false, reason: "audit_failed", number: delivered.number! };
  if (delivered) return { ok: true, number: delivered.number! };
  if (mine.some((r) => r.skippedReason === "already_claimed")) return { ok: false, reason: "already_sent_today" };
  if (mine.some((r) => r.skippedReason === "send_failed")) return { ok: false, reason: "send_failed" };
  return { ok: false, reason: "not_eligible" };
}
