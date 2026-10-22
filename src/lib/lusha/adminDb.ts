// DB side of lusha-per-bd: the switch (read for enforcement, written only by an admin, audited in the same transaction) and the
// per-BD consumption report. The report needs no storage of its own: every reveal is a lusha_reveal row with its actor.

import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bd } from "@/db/schema";
import { assertAdminRole } from "@/lib/auth/adminRole";
import { DRILLDOWN_ROW_LIMIT } from "@/lib/reports/drilldownLimit";
import { buildRevealDrilldownRows, type RevealDrilldownRawRow, type RevealDrilldownRow } from "./revealsDrilldown";
import { mapUsageRow, type RawUsageRow, type UsageRow } from "./usageReport";

export const LUSHA_AUDIT_ACTIONS = { enable: "bd_lusha_enable", disable: "bd_lusha_disable" } as const;

/** Fail closed: an unknown BD id is not enabled. */
export async function isLushaEnabled(bdId: string, reader: Pick<typeof db, "select"> = db): Promise<boolean> {
  const [row] = await reader.select({ on: bd.lushaEnabled }).from(bd).where(eq(bd.id, bdId));
  return row?.on === true;
}

export type SetEnabledResult = { ok: true; changed: boolean } | { ok: false; reason: "not_found" };

/**
 * Flips one BD's switch. Admin-only HERE as well as in the action, so no caller can reach the write without the check. The
 * UPDATE only matches a row whose value differs, so repeating a click records nothing; the audit row (actor = the admin,
 * target = the BD) is written in the same transaction as the change. Revert: set the column back and the row stays as history.
 */
export async function setLushaEnabled(input: { actor: { id: string; role: string }; bdId: string; enabled: boolean }): Promise<SetEnabledResult> {
  assertAdminRole(input.actor);
  return db.transaction(async (tx) => {
    const changed = await tx.update(bd).set({ lushaEnabled: input.enabled }).where(and(eq(bd.id, input.bdId), ne(bd.lushaEnabled, input.enabled))).returning({ id: bd.id });
    if (changed.length === 0) return (await tx.select({ id: bd.id }).from(bd).where(eq(bd.id, input.bdId))).length ? { ok: true, changed: false } : { ok: false, reason: "not_found" };
    await tx.insert(auditLog).values({ actorBdId: input.actor.id, action: input.enabled ? LUSHA_AUDIT_ACTIONS.enable : LUSHA_AUDIT_ACTIONS.disable, targetBdId: input.bdId, metadata: { enabled: input.enabled } });
    return { ok: true, changed: true };
  });
}

/**
 * One query, one row per BD (disabled ones included). Each source is aggregated to one row per BD BEFORE it is joined, so no
 * sum is multiplied by another table's rows. Spend and reveals are by reservation time ("at", the cap's own clock);
 * rejections by rejected_at; last use is all-time. Charged = credits_charged only; pending = reserved and never charged.
 */
export async function getLushaUsageReport(window: { start: Date; end: Date }): Promise<UsageRow[]> {
  const rows = (await db.execute(buildUsageReportQuery(window))) as unknown as RawUsageRow[];
  return Array.from(rows, mapUsageRow);
}

/** Exported (not executed) so tests can compile it: the "Revelados" drill-down must keep the same filters as ur_spend below. */
export function buildUsageReportQuery(window: { start: Date; end: Date }): SQL {
  const start = window.start.toISOString();
  const end = window.end.toISOString();
  return sql`
    with ur_spend as (
      select actor_bd_id as ur_bd,
        coalesce(sum(credits_charged), 0) as ur_charged,
        coalesce(sum(credits_reserved) filter (where credits_charged is null), 0) as ur_pending,
        count(*) filter (where field = 'emails' and state = 'settled' and outcome = 'revealed') as ur_emails,
        count(*) filter (where field = 'phones' and state = 'settled' and outcome = 'revealed') as ur_phones
      from lusha_reveal
      where actor_bd_id is not null and at >= ${start}::timestamptz and at < ${end}::timestamptz
      group by actor_bd_id
    ), ur_rej as (
      select rejected_by_bd_id as ur_bd, count(*) as ur_n
      from lusha_reveal
      where rejected_by_bd_id is not null and rejected_at >= ${start}::timestamptz and rejected_at < ${end}::timestamptz
      group by rejected_by_bd_id
    ), ur_last as (
      select actor_bd_id as ur_bd, max(at) as ur_at from lusha_reveal where actor_bd_id is not null group by actor_bd_id
    ), ur_toggle as (
      select distinct on (a.target_bd_id) a.target_bd_id as ur_bd, who.name as ur_who, a.at as ur_at
      from audit_log a join bd who on who.id = a.actor_bd_id
      where a.action in (${LUSHA_AUDIT_ACTIONS.enable}, ${LUSHA_AUDIT_ACTIONS.disable}) and a.target_bd_id is not null
      order by a.target_bd_id, a.at desc
    )
    select b.id::text as ur_bd_id, b.name as ur_name, b.email as ur_email, b.role as ur_role, b.lusha_enabled as ur_enabled,
      b.created_at as ur_created_at, b.lusha_personal_daily_credit_cap as ur_personal_cap,
      coalesce(s.ur_charged, 0) as ur_charged, coalesce(s.ur_pending, 0) as ur_pending,
      coalesce(s.ur_emails, 0) as ur_emails, coalesce(s.ur_phones, 0) as ur_phones,
      coalesce(r.ur_n, 0) as ur_rejections, l.ur_at as ur_last_use, t.ur_who as ur_toggle_by, t.ur_at as ur_toggle_at
    from bd b
    left join ur_spend s on s.ur_bd = b.id
    left join ur_rej r on r.ur_bd = b.id
    left join ur_last l on l.ur_bd = b.id
    left join ur_toggle t on t.ur_bd = b.id
    order by coalesce(s.ur_charged, 0) desc, b.name
  `;
}

/**
 * The reveals behind the "Revelados" KPI, newest first. INVARIANT: this list has exactly as many rows as the KPI number
 * (ur_emails + ur_phones of getLushaUsageReport), so it applies the same five filters: field in (emails, phones), settled,
 * revealed, inside the window, and a live actor. The actor filter is the INNER JOIN on bd: ur_spend drops actor_bd_id is null
 * (a deleted BD's reveals are counted by nobody), so a LEFT JOIN "to not lose rows" would make the dialog show more rows than
 * the number it explains. Production on 2026-10-22: 14 revealed rows, 0 with a null actor, value or credits_charged.
 * Rejected matches and value-less attempts are deliberately absent: they have their own column in the report.
 */
export function buildRevealsDrilldownQuery(window: { start: Date; end: Date }): SQL {
  const start = window.start.toISOString();
  const end = window.end.toISOString();
  return sql`
    select r.id::text as rd_reveal_id, r.person_id::text as rd_person_id,
      trim(concat_ws(' ', p.first_name, p.last_name)) as rd_person_name, p.company as rd_company,
      r.field as rd_field, r.value as rd_value, b.id::text as rd_actor_bd_id, b.name as rd_actor_bd_name,
      r.at as rd_at, r.credits_charged as rd_credits_charged
    from lusha_reveal r
    join bd b on b.id = r.actor_bd_id
    join person p on p.id = r.person_id
    where r.field in ('emails', 'phones') and r.state = 'settled' and r.outcome = 'revealed'
      and r.at >= ${start}::timestamptz and r.at < ${end}::timestamptz
    order by r.at desc, r.id
    limit ${DRILLDOWN_ROW_LIMIT}
  `;
}

/** Read on demand when the dialog opens (never in the page's own load). One query. */
export async function getRevealsDrilldown(window: { start: Date; end: Date }): Promise<RevealDrilldownRow[]> {
  const rows = (await db.execute(buildRevealsDrilldownQuery(window))) as unknown as RevealDrilldownRawRow[];
  return buildRevealDrilldownRows(Array.from(rows));
}
