/**
 * The ONE definition, in SQL, of a follow-up item that is still open in its cycle (follow-up-expiry). Shared by the page read
 * (queueQueries.ts), the cap computation and the new-entry exclusion (candidateQuery.ts), the sidebar badge
 * (appShellBadgeCountsQuery.ts) and the expiry job (dropQueries.ts), so they can never disagree about what is on the page.
 *
 * A `follow_up_queue_item` row that opened a cycle (`cycle_started_on` set) is OPEN while all of these hold:
 *  - its person is still the BD's own, not merged, still contacted/replied and not at an active client (the page's old guards);
 *  - the owner's WORK has not closed it: no activity of `CYCLE_CLOSING_ACTIVITY_TYPES` (note, call, meeting, sent email,
 *    discard, plus a reply: WORKED_ACTIVITY_TYPES + `reply_received`) with a work-done time after the row's `last_touch_at`,
 *    and no newer `person_bd_connection.last_message_at`. Time is `workDoneAtSql()`, NOT `effectiveActivityAtSql()`: deleting a
 *    note is text cleanup and must not un-count work (owner rule, the same one the worked-today reads follow);
 *  - nobody dropped it since the row was written (a `follow_up_dropped` / `follow_up_expired` activity created at or after it).
 *
 * This is deliberately NARROWER than the clock that decides who ENTERS the queue (`fuq_last_touch`, candidateQuery.ts), which counts
 * every activity that is not NO_PROGRESS: a Hunter lookup, a status change or other system row moves that clock, but must not
 * reset a Vencido's deadline. `person_bd_connection.last_message_at` (a LinkedIn message) stays a closing touch in both.
 *
 * `workedBeforeIso` relaxes the "closed" test for the PAGE read only, and only for the BD's own WORK (WORKED_ACTIVITY_TYPES): work done
 * at or after that instant (the start of today) does not close the row, so an item the BD worked today stays visible as done for the rest of the day, like a worked day-0 item. A
 * reply or a LinkedIn message stays a strict closer even today (the contact answered; the item leaves the page, the badge and the
 * drop together). The badge, the cap and the job leave it unset (strict).
 *
 * The queue row is referenced by `rowRef` (default UNALIASED `follow_up_queue_item`) and every other table through its schema
 * object, like candidateQuery.ts. Callers add the date window and the state filter that fit them.
 */
import { sql } from "drizzle-orm";
import { activity, person, personBdConnection } from "@/db/schema";
import { workDoneAtSql } from "@/lib/contacts/effectiveActivityTime";
import { notActiveClientCompanySql } from "@/lib/followUp/activeClientExclusion";
import { FOLLOW_UP_DROP_ACTIVITY_TYPES } from "@/lib/followUp/activityTypes";
import { FOLLOW_UP_EXPIRY_DAYS, FOLLOW_UP_OVERDUE_FROM_DAY } from "@/lib/followUp/cycle";
import { WORKED_ACTIVITY_TYPES, workedTodayAtSql } from "@/lib/followUp/queueSelection";

/** Expiry looks back this far for items the job missed (a skipped run); older ones were dropped long ago or never shown. */
export const EXPIRY_LOOKBACK_DAYS = 30;

/** What closes a cycle: the owner's worked set plus the contact's reply. NOT hunter_lookup, status_change or other system rows. */
export const CYCLE_CLOSING_ACTIVITY_TYPES: readonly string[] = [...WORKED_ACTIVITY_TYPES, "reply_received"];

function typeList(types: readonly string[]) {
  return sql.join(
    types.map((t) => sql`${t}`),
    sql`, `,
  );
}

export function openCycleRowSql({ rowRef = "follow_up_queue_item", workedBeforeIso }: { rowRef?: string; workedBeforeIso?: string } = {}) {
  const row = sql.raw(rowRef);
  // The entry clock (`fuq_last_touch`) ignores a soft-deleted note, so a note that was ALREADY deleted when the row was written
  // looks newer than the row's `last_touch_at` forever. It must not close the row it predates: the row would be born closed, the
  // contact (still due by the entry clock) would be queued again every day, and "a cycle owns one row" would break. Work that
  // happens, and is then deleted, after the row exists still closes it (deleting a note never un-counts work).
  const notBornClosed = sql`and (activity.deleted_at is null or activity.created_at >= ${row}.created_at)`;
  // Relaxed (page read): the BD's own work today stays visible as done, so it is split from the strict closers. A reply or a
  // LinkedIn message is the CONTACT answering: it ends the item for the page, the badge, the cap and the drop alike.
  const strictTypes = workedBeforeIso ? ["reply_received"] : CYCLE_CLOSING_ACTIVITY_TYPES;
  const relaxedWork = workedBeforeIso
    ? sql`and not exists (
      select 1 from ${activity}
      where activity.person_id = ${row}.person_id
        and activity.type in (${typeList([...WORKED_ACTIVITY_TYPES])})
        and ${workDoneAtSql()} > ${row}.last_touch_at
        and ${workedTodayAtSql()} < ${workedBeforeIso}::timestamptz
        ${notBornClosed}
    )`
    : sql``;
  return sql`(
    exists (
      select 1 from ${person}
      where person.id = ${row}.person_id
        and person.merged_into_id is null
        and person.owner_bd_id = ${row}.bd_id
        and person.status in ('contacted', 'replied')
        and ${notActiveClientCompanySql(sql`person.company_key`)}
    )
    and not exists (
      select 1 from ${activity}
      where activity.person_id = ${row}.person_id
        and activity.type in (${typeList(strictTypes)})
        and ${workDoneAtSql()} > ${row}.last_touch_at
        ${notBornClosed}
    )
    ${relaxedWork}
    and not exists (
      select 1 from ${personBdConnection}
      where person_bd_connection.person_id = ${row}.person_id
        and person_bd_connection.last_message_at > ${row}.last_touch_at
    )
    and not exists (
      select 1 from ${activity}
      where activity.person_id = ${row}.person_id
        and activity.type in (${typeList(FOLLOW_UP_DROP_ACTIVITY_TYPES)})
        and activity.created_at >= ${row}.created_at
    )
  )`;
}

/**
 * A row carried over from an EARLIER day that is still open and not yet past its deadline, for one BD on `queueDate`
 * (an ART `YYYY-MM-DD` string, cast here). A postponed/skipped row comes back once its `snoozed_until` is reached. The
 * `queue_date` bounds are redundant with `cycle_started_on` (the opening row's queue_date IS its cycle date) and exist to use
 * the (bd_id, queue_date) index. `workedBeforeIso` is the page read's relaxation (see openCycleRowSql).
 */
export function carriedOpenItemSql(bdId: string, queueDate: string, workedBeforeIso?: string) {
  return sql`(
    follow_up_queue_item.bd_id = ${bdId}::uuid
    and follow_up_queue_item.cycle_started_on is not null
    and follow_up_queue_item.queue_date < ${queueDate}::date
    and follow_up_queue_item.queue_date > ${queueDate}::date - ${FOLLOW_UP_EXPIRY_DAYS}::int
    and follow_up_queue_item.cycle_started_on > ${queueDate}::date - ${FOLLOW_UP_EXPIRY_DAYS}::int
    and (follow_up_queue_item.state = 'pending' or follow_up_queue_item.snoozed_until <= ${queueDate}::date)
    and ${openCycleRowSql({ workedBeforeIso })}
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

/** One pass over a BD's carried items: how many, and how many of them are Vencido (3+ days in the queue). A derived table for a FROM. */
export function carriedSummarySql(bdId: string, queueDate: string) {
  return sql`(
    select count(*)::int as fuc_total,
      (count(*) filter (where follow_up_queue_item.cycle_started_on <= ${queueDate}::date - ${FOLLOW_UP_OVERDUE_FROM_DAY}::int))::int as fuc_overdue
    from follow_up_queue_item
    where ${carriedOpenItemSql(bdId, queueDate)}
  )`;
}
