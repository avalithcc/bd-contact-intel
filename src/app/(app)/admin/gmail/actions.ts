"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getSiteUrl } from "@/lib/config/siteUrl";
import { sendManualReminder, type ManualReminderResult } from "@/lib/gmail/manualReminder";
import { claimGmailReminderManual, getReminderRows, markGmailReminderFailed, markGmailReminderSent, markGmailReminderSentAudited } from "@/lib/gmail/reminderQueries";
import { sendDigestEmail } from "@/lib/mailer/smtpMailer";
import { isUuid } from "@/lib/uuid";

/**
 * "Enviar recordatorio" for one BD. requireAdmin runs FIRST and throws for anyone else; sendManualReminder asserts the role
 * again. The send goes through the cron's own runner (claim, send, mark), counts in the 3-reminder series and writes an audit
 * row with the admin as actor in the same step that marks it sent. Viewing the screen is not audited; this is.
 */
export async function sendGmailReminderAction(bdId: string): Promise<ManualReminderResult> {
  const admin = await requireAdmin();
  if (!isUuid(bdId)) return { ok: false, reason: "not_found" };
  const result = await sendManualReminder(
    { admin, bdId, now: new Date(), siteUrl: getSiteUrl() },
    {
      readRows: () => getReminderRows(),
      send: sendDigestEmail,
      claim: claimGmailReminderManual,
      markSentAudited: (claimId, audit) => markGmailReminderSentAudited(claimId, audit),
      markSent: (claimId) => markGmailReminderSent(claimId),
      markFailed: markGmailReminderFailed,
    },
  );
  if (result.ok || result.reason === "audit_failed") revalidatePath("/admin/gmail");
  return result;
}
