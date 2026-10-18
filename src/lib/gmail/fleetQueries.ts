/**
 * DB side of the admin "Estado de Gmail" screen. ONE statement for the whole fleet (PERFORMANCE.md: round trips are the budget):
 * the bd row, its email_account (left join: no row = never connected), the newest synced email, the sent reminders, the 30-day
 * bounces split by severity and the failed scheduled sends, each aggregated to at most one row per BD BEFORE it joins, so
 * nothing fans out. Decisions live in the pure fleetView.ts; this file only reads.
 *
 * Plan on production (2026-10-18, 5 BDs, 3,208 messages): the newest-email lateral is a top-1 per BD (migration 0052 adds
 * email_message_bd_sent_idx so it stays one index probe per BD as the table grows; before it, 3.6 ms and 2,115 buffers by
 * sorting every message of each BD); bounces use activity_type_idx; failed sends use scheduled_email_bd_status_idx.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fleetRowToRaw, type FleetSqlRow } from "./fleetRows";
import { buildFleetRow, type FleetRow } from "./fleetView";

/** How far back the bounce counter looks. */
export const FLEET_BOUNCE_WINDOW_DAYS = 30;

/**
 * Every BD that has something to monitor, sorted by name. A non-admin BD with reminders switched off and no Gmail account is a
 * test account or someone who left: there is nothing to monitor, so it is left out (as the reminder cron skips it).
 */
export async function getGmailFleetHealth(now: Date, limit = 200): Promise<FleetRow[]> {
  const since = new Date(now.getTime() - FLEET_BOUNCE_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = (await db.execute(sql`
    select
      b.id::text as fl_bd_id,
      b.name as fl_name,
      b.email as fl_email,
      b.role as fl_role,
      b.email_reminders_enabled as fl_reminders_enabled,
      b.created_at as fl_created_at,
      b.last_seen_at as fl_last_seen_at,
      (ea.bd_id is not null) as fl_has_account,
      ea.status as fl_status,
      ea.granted_scopes as fl_scopes,
      ea.sync_error as fl_sync_error,
      ea.last_synced_at as fl_last_synced_at,
      ea.connected_at as fl_connected_at,
      (ea.history_id is not null) as fl_has_cursor,
      (ea.backfill_page_token is not null) as fl_backfilling,
      coalesce(
        (select json_agg(g.sent_at) from gmail_reminder_send g where g.bd_id = b.id and g.status = 'sent'),
        '[]'::json
      ) as fl_sent,
      lm.sent_at as fl_last_email_at,
      lm.direction as fl_last_email_direction,
      bn.hard as fl_bounces_hard,
      bn.soft as fl_bounces_soft,
      sf.failed as fl_failed_sends,
      sf.last_error as fl_last_failed_error
    from bd b
    left join email_account ea on ea.bd_id = b.id
    left join lateral (
      select m.sent_at, m.direction from email_message m where m.bd_id = b.id order by m.sent_at desc limit 1
    ) lm on true
    left join (
      select a.actor_bd_id,
        count(*) filter (where a.metadata->>'severity' = 'hard') as hard,
        count(*) filter (where a.metadata->>'severity' = 'soft') as soft
      from activity a
      where a.type = 'email_bounced' and a.created_at >= ${since}::timestamptz and a.actor_bd_id is not null
      group by a.actor_bd_id
    ) bn on bn.actor_bd_id = b.id
    left join (
      select s.bd_id, count(*) as failed, (array_agg(s.error order by s.updated_at desc))[1] as last_error
      from scheduled_email s
      where s.status = 'failed'
      group by s.bd_id
    ) sf on sf.bd_id = b.id
    where b.role = 'admin' or b.email_reminders_enabled or ea.bd_id is not null
    order by b.name
    limit ${limit}
  `)) as unknown as FleetSqlRow[];
  return rows.map((r) => buildFleetRow(fleetRowToRaw(r), now)).sort((a, b) => a.name.localeCompare(b.name, "es"));
}
