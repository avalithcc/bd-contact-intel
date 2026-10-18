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
  markFailed(claimId: string, sanitizedError: string): Promise<void>;
}

export type ManualReminderResult =
  | { ok: true; number: number }
  | { ok: false; reason: "not_found" | "not_eligible" | "already_sent_today" | "send_failed" };

export async function sendManualReminder(
  input: { admin: { id: string; role: string }; bdId: string; now: Date; siteUrl: string },
  deps: ManualReminderDeps,
): Promise<ManualReminderResult> {
  assertAdminRole(input.admin);
  const rows = await deps.readRows();
  if (!rows.some((r) => r.rm_bd_id === input.bdId)) return { ok: false, reason: "not_found" };

  let claimed: { number: number; sentOn: string } | null = null;
  const outcome = await runGmailReminders(
    { rows, now: input.now, siteUrl: input.siteUrl, dryRun: false, onlyBdId: input.bdId },
    {
      send: deps.send,
      claim: async (bdId, sentOn, number) => {
        const id = await deps.claim(bdId, sentOn, number);
        if (id) claimed = { number, sentOn };
        return id;
      },
      markSent: (claimId) => deps.markSentAudited(claimId, { actorBdId: input.admin.id, bdId: input.bdId, number: claimed!.number, sentOn: claimed!.sentOn }),
      markFailed: deps.markFailed,
    },
  );

  const mine = outcome.results.filter((r) => r.bdId === input.bdId);
  const delivered = mine.find((r) => r.sent && r.number !== undefined);
  if (delivered) return { ok: true, number: delivered.number! };
  if (mine.some((r) => r.skippedReason === "already_claimed")) return { ok: false, reason: "already_sent_today" };
  if (mine.some((r) => r.skippedReason === "send_failed")) return { ok: false, reason: "send_failed" };
  return { ok: false, reason: "not_eligible" };
}
