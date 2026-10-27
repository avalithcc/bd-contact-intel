/**
 * The ONE definition, in SQL, of a follow-up item that is still open in its cycle (follow-up-expiry). Shared by the page read
 * (queueQueries.ts), the cap computation (candidateQuery.ts), the sidebar badge (appShellBadgeCountsQuery.ts) and the expiry
 * job (dropQueries.ts), so the four can never disagree about what is on the page.
 *
 * A `follow_up_queue_item` row that opened a cycle (`cycle_started_on` set) is OPEN while all of these hold:
 *  - its person is still the BD's own, not merged, still contacted/replied and not at an active client (the page's old guards);
 *  - no touch happened after the row's `last_touch_at` (any activity that is not NO_PROGRESS or NON_TOUCH, or a newer
 *    `person_bd_connection.last_message_at`): a touch ends the cycle, and `last_touch_at` is exactly what fuq_last_touch was
 *    when the row was written, so "no newer touch" is the same clock the selection used;
 *  - nobody dropped it since the row was written (a `follow_up_dropped` / `follow_up_expired` activity created at or after the row).
 *
 * The queue row is referenced UNALIASED (`follow_up_queue_item`) and every other table through its schema object, like
 * candidateQuery.ts. Callers add the date window and the state filter that fit them.
 */
import { sql } from "drizzle-orm";
import { activity, person, personBdConnection } from "@/db/schema";
import { NO_PROGRESS_ACTIVITY_TYPES } from "@/lib/activity/noProgressActivity";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
import { notActiveClientCompanySql } from "@/lib/followUp/activeClientExclusion";
import { FOLLOW_UP_DROP_ACTIVITY_TYPES } from "@/lib/followUp/activityTypes";
import { FOLLOW_UP_EXPIRY_DAYS, FOLLOW_UP_OVERDUE_FROM_DAY } from "@/lib/followUp/cycle";

function typeList(types: readonly string[]) {
  return sql.join(
    types.map((t) => sql`${t}`),
    sql`, `,
  );
}

export function openCycleRowSql() {
  return sql`(
    exists (
      select 1 from ${person}
      where person.id = follow_up_queue_item.person_id
        and person.merged_into_id is null
        and person.owner_bd_id = follow_up_queue_item.bd_id
        and person.status in ('contacted', 'replied')
        and ${notActiveClientCompanySql(sql`person.company_key`)}
    )
    and not exists (
      select 1 from ${activity}
      where activity.person_id = follow_up_queue_item.person_id
        and activity.type not in (${typeList(NO_PROGRESS_ACTIVITY_TYPES)})
        and ${effectiveActivityAtSql()} > follow_up_queue_item.last_touch_at
    )
    and not exists (
      select 1 from ${personBdConnection}
      where person_bd_connection.person_id = follow_up_queue_item.person_id
        and person_bd_connection.last_message_at > follow_up_queue_item.last_touch_at
    )
    and not exists (
      select 1 from ${activity}
      where activity.person_id = follow_up_queue_item.person_id
        and activity.type in (${typeList(FOLLOW_UP_DROP_ACTIVITY_TYPES)})
        and activity.created_at >= follow_up_queue_item.created_at
    )
  )`;
}

/**
 * A row carried over from an EARLIER day that is still open and not yet past its deadline, for one BD on `queueDate`
 * (an ART `YYYY-MM-DD` string, cast here). A postponed/skipped row comes back once its `snoozed_until` is reached. The
 * `queue_date` bounds are redundant with `cycle_started_on` (the opening row's queue_date IS its cycle date) and exist to use
 * the (bd_id, queue_date) index.
 */
export function carriedOpenItemSql(bdId: string, queueDate: string) {
  return sql`(
    follow_up_queue_item.bd_id = ${bdId}::uuid
    and follow_up_queue_item.cycle_started_on is not null
    and follow_up_queue_item.queue_date < ${queueDate}::date
    and follow_up_queue_item.queue_date > ${queueDate}::date - ${FOLLOW_UP_EXPIRY_DAYS}::int
    and follow_up_queue_item.cycle_started_on > ${queueDate}::date - ${FOLLOW_UP_EXPIRY_DAYS}::int
    and (follow_up_queue_item.state = 'pending' or follow_up_queue_item.snoozed_until <= ${queueDate}::date)
    and ${openCycleRowSql()}
  )`;
}

/** The carried items still in "Hoy" (days 1-2 in the queue): the only carried ones that use the daily cap. */
export function carriedNormalCountSql(bdId: string, queueDate: string) {
  return sql`(
    select count(*) from follow_up_queue_item
    where ${carriedOpenItemSql(bdId, queueDate)}
      and follow_up_queue_item.cycle_started_on > ${queueDate}::date - ${FOLLOW_UP_OVERDUE_FROM_DAY}::int
  )`;
}

/** Carried items that are Vencido (3+ days in the queue) on `queueDate`. */
export function carriedOverdueCountSql(bdId: string, queueDate: string) {
  return sql`(
    select count(*) from follow_up_queue_item
    where ${carriedOpenItemSql(bdId, queueDate)}
      and follow_up_queue_item.cycle_started_on <= ${queueDate}::date - ${FOLLOW_UP_OVERDUE_FROM_DAY}::int
  )`;
}
