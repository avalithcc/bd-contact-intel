/**
 * DB glue for the Gmail reminder cron (src/app/api/gmail/reminders/route.ts). Imports `db`, so like digestQueries.ts the
 * decisions live in the pure reminderPlan.ts / reminderRows.ts and this file is covered by tests/db/gmailReminder.test.ts.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, gmailReminderSend } from "@/db/schema";
import { MANUAL_REMINDER_AUDIT_ACTION, type ManualReminderAudit } from "./manualReminder";
import type { ReminderRow } from "./reminderRows";

/**
 * ONE statement for every BD: the bd row, its email_account (left join: no row = never connected), and its `sent` reminders
 * pre-aggregated in a correlated subquery so the join cannot fan out. Bounded by `limit` (there are a handful of BDs).
 */
export async function getReminderRows(limit = 500): Promise<ReminderRow[]> {
  const rows = (await db.execute(sql`
    select
      b.id::text as rm_bd_id,
      b.name as rm_name,
      b.email as rm_email,
      b.role as rm_role,
      b.email_reminders_enabled as rm_reminders_enabled,
      b.created_at as rm_created_at,
      b.last_seen_at as rm_last_seen_at,
      (ea.bd_id is not null) as rm_has_account,
      ea.status as rm_status,
      ea.granted_scopes as rm_scopes,
      ea.sync_error as rm_sync_error,
      ea.last_synced_at as rm_last_synced_at,
      ea.connected_at as rm_connected_at,
      coalesce(
        (select json_agg(g.sent_at) from gmail_reminder_send g where g.bd_id = b.id and g.status = 'sent'),
        '[]'::json
      ) as rm_sent
    from bd b
    left join email_account ea on ea.bd_id = b.id
    order by b.created_at
    limit ${limit}
  `)) as unknown as ReminderRow[];
  return rows;
}

/**
 * Claim-before-send, same idea as claimDigestSend: returns the row id only when this call inserted the (bd, day) row.
 * No abandoned-claim reclaim: a `pending` row left by a dead run blocks only that day, and the series counts `sent` rows
 * only, so tomorrow's run plans the same reminder again.
 */
export async function claimGmailReminder(bdId: string, sentOn: string, reminderNumber: number): Promise<string | null> {
  const [inserted] = await db
    .insert(gmailReminderSend)
    .values({ bdId, sentOn, reminderNumber, status: "pending" })
    .onConflictDoNothing({ target: [gmailReminderSend.bdId, gmailReminderSend.sentOn] })
    .returning({ id: gmailReminderSend.id });
  return inserted?.id ?? null;
}

/**
 * The manual send's claim: the cron's claim, except that today's row is taken over when its send FAILED (an admin retrying
 * after an SMTP error must not be told "already sent"). A `sent` row or a `pending` one (a send in flight) still blocks.
 */
export async function claimGmailReminderManual(bdId: string, sentOn: string, reminderNumber: number): Promise<string | null> {
  const [claimed] = await db
    .insert(gmailReminderSend)
    .values({ bdId, sentOn, reminderNumber, status: "pending" })
    .onConflictDoUpdate({
      target: [gmailReminderSend.bdId, gmailReminderSend.sentOn],
      set: { status: "pending", error: null, reminderNumber },
      setWhere: eq(gmailReminderSend.status, "failed"),
    })
    .returning({ id: gmailReminderSend.id });
  return claimed?.id ?? null;
}

export async function markGmailReminderSent(id: string, at: Date = new Date()): Promise<void> {
  await db.update(gmailReminderSend).set({ status: "sent", sentAt: at }).where(eq(gmailReminderSend.id, id));
}

/** `error` must already be sanitized — see src/lib/tasks/sendErrorSanitizer.ts. */
export async function markGmailReminderFailed(id: string, error: string): Promise<void> {
  await db.update(gmailReminderSend).set({ status: "failed", error }).where(eq(gmailReminderSend.id, id));
}

/**
 * The manual send's version of markGmailReminderSent: the row becomes `sent` and the audit row (actor = the admin, target =
 * the BD) is written in ONE transaction, so a reminder that counts in the series is never unaudited.
 */
export async function markGmailReminderSentAudited(id: string, audit: ManualReminderAudit, at: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(gmailReminderSend).set({ status: "sent", sentAt: at }).where(eq(gmailReminderSend.id, id));
    await tx.insert(auditLog).values({
      actorBdId: audit.actorBdId,
      action: MANUAL_REMINDER_AUDIT_ACTION,
      targetBdId: audit.bdId,
      metadata: { reminderNumber: audit.number, sentOn: audit.sentOn },
    });
  });
}
