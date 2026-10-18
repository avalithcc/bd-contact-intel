/**
 * Maps the raw-SQL row behind the Gmail fleet view (fleetQueries.ts) to the view-model's input. Pure. Raw `sql` results come
 * back with timestamps as strings (or Dates, by driver path) and aggregates as strings or numbers, so every one is normalized here.
 */
import type { FleetAccount, FleetRaw } from "./fleetView";

export interface FleetSqlRow {
  fl_bd_id: string;
  fl_name: string;
  fl_email: string;
  fl_role: string;
  fl_reminders_enabled: boolean;
  fl_created_at: Date | string;
  fl_last_seen_at: Date | string | null;
  fl_has_account: boolean;
  fl_status: string | null;
  fl_scopes: string | null;
  fl_sync_error: string | null;
  fl_last_synced_at: Date | string | null;
  fl_connected_at: Date | string | null;
  fl_has_cursor: boolean | null;
  fl_backfilling: boolean | null;
  /** `sent_at` of every `sent` reminder (json_agg). */
  fl_sent: (Date | string)[];
  fl_last_email_at: Date | string | null;
  fl_last_email_direction: string | null;
  fl_bounces_hard: number | string | null;
  fl_bounces_soft: number | string | null;
  fl_failed_sends: number | string | null;
  fl_last_failed_error: string | null;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));
const toDateOrNull = (v: Date | string | null): Date | null => (v === null ? null : toDate(v));
const toCount = (v: number | string | null): number => Number(v ?? 0);

export function fleetRowToRaw(r: FleetSqlRow): FleetRaw {
  const account: FleetAccount | null = r.fl_has_account
    ? {
        status: r.fl_status,
        grantedScopes: r.fl_scopes,
        syncError: r.fl_sync_error,
        lastSyncedAt: toDateOrNull(r.fl_last_synced_at),
        connectedAt: toDateOrNull(r.fl_connected_at),
        hasCursor: r.fl_has_cursor === true,
        backfilling: r.fl_backfilling === true,
      }
    : null;
  const lastEmailAt = toDateOrNull(r.fl_last_email_at);
  return {
    bdId: r.fl_bd_id,
    name: r.fl_name,
    email: r.fl_email,
    role: r.fl_role,
    remindersEnabled: r.fl_reminders_enabled,
    createdAt: toDate(r.fl_created_at),
    lastSeenAt: toDateOrNull(r.fl_last_seen_at),
    account,
    sentReminders: r.fl_sent.map(toDate),
    lastEmail: lastEmailAt ? { at: lastEmailAt, direction: r.fl_last_email_direction === "outbound" ? "outbound" : "inbound" } : null,
    bouncesHard: toCount(r.fl_bounces_hard),
    bouncesSoft: toCount(r.fl_bounces_soft),
    failedSends: toCount(r.fl_failed_sends),
    lastFailedError: r.fl_last_failed_error,
  };
}
