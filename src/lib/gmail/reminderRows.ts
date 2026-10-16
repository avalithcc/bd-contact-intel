/**
 * Maps the raw-SQL row behind the Gmail reminder run (reminderQueries.ts) to the planner's input. Pure. Raw `sql` results
 * come back with timestamps as strings (or Dates, depending on the driver path), so every timestamp is normalized here.
 */
import { isGmailUnhealthy, type ReminderCandidate } from "./reminderPlan";

export interface ReminderRow {
  rm_bd_id: string;
  rm_name: string;
  rm_email: string;
  rm_role: string;
  rm_reminders_enabled: boolean;
  rm_created_at: Date | string;
  rm_last_seen_at: Date | string | null;
  rm_has_account: boolean;
  rm_status: string | null;
  rm_scopes: string | null;
  rm_sync_error: string | null;
  rm_last_synced_at: Date | string | null;
  rm_connected_at: Date | string | null;
  /** `sent_at` of every `sent` reminder row (json_agg), as ISO strings. */
  rm_sent: (Date | string)[];
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));
const toDateOrNull = (v: Date | string | null): Date | null => (v === null ? null : toDate(v));

export function rowToCandidate(r: ReminderRow, now: Date): ReminderCandidate {
  const account = r.rm_has_account
    ? {
        status: r.rm_status,
        grantedScopes: r.rm_scopes,
        syncError: r.rm_sync_error,
        lastSyncedAt: toDateOrNull(r.rm_last_synced_at),
        connectedAt: toDateOrNull(r.rm_connected_at),
      }
    : null;
  return {
    bdId: r.rm_bd_id,
    role: r.rm_role,
    // bd.email_reminders_enabled: switched off by the migration for the e2e test accounts (and any BD who left).
    excluded: !r.rm_reminders_enabled,
    createdAt: toDate(r.rm_created_at),
    lastSeenAt: toDateOrNull(r.rm_last_seen_at),
    gmailUnhealthy: isGmailUnhealthy(account, now),
    sentReminders: r.rm_sent.map(toDate),
  };
}
