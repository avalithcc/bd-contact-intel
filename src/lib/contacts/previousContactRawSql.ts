import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { activity } from "@/db/schema";
import { LINKEDIN_LAST_ACTIVITY_TYPE } from "@/lib/contacts/lastActivity";
import { PREVIOUS_CONTACT_ACTIVITY_TYPES } from "@/lib/outreach/previousContact";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";

/**
 * The "Contacto previo" correlated subquery of the Outreach view: WHICH CRM user
 * last had a recorded touch with one person, as `{ source, bdId, at }` JSON
 * (the `PreviousContactRaw` shape of outreach/previousContact.ts), or NULL.
 * Twin of lastActivityRawSql.ts, with the same shape on purpose so the two cannot
 * drift; the difference is that only rows with a PERSON behind them count.
 *
 * Effective time, never `activity.created_at`: effectiveActivityAtSql() is NULL
 * for the task_* types (editing a task is not a touch, so it is filtered out by
 * `is not null`) and pins a status_backfill / call / email_sent row to its
 * historical time instead of the day the migration or the sync inserted it.
 * `activity.type in (...)` keeps only types where a CRM user engaged the person
 * (PREVIOUS_CONTACT_ACTIVITY_TYPES): a Lusha reveal, a bounce or an auto-reply
 * reached nobody. `actor_bd_id is not null` drops the migration's own rows (a status_backfill is
 * written with no actor by design), so an import never reads as a person.
 *
 * A scalar subquery: one value per outer row, so it cannot fan out the outreach
 * query's GROUP BY / sum(). `activity.person_id` is literal SQL for the reason
 * given in lastActivityRawSql.ts.
 *
 * The CRM user's NAME is resolved here too (`name`, from `bd`: a handful of rows, a
 * primary-key probe), not by a separate roster read: on this database every extra
 * statement in the page's parallel wait cost about a second, a measured regression
 * (see the PR notes), while this adds ~30ms of server time for the whole lane.
 * A NULL name (a deleted BD) makes the resolver treat the touch as unattributed.
 *
 * NEWEST WINS between the activity and the LinkedIn connection that has sent
 * messages (`sent_count > 0`: the BD wrote first; a bare connection is not
 * contact). An exact tie goes to the activity. `last_message_at` may be NULL on
 * a connection row, hence `nulls last`; such a row still names its BD when it is
 * the only signal.
 *
 * @param personId the outer query's person id expression
 */
export function previousContactRawSql(personId: SQLWrapper): SQL {
  return sql`(
    select case
      when a.at is not null and (li.bd_id is null or li.at is null or a.at >= li.at)
        then json_build_object('source', a.type, 'bdId', a.actor_bd_id, 'name', a.name, 'at', a.at)
      when li.bd_id is not null
        then json_build_object('source', ${LINKEDIN_LAST_ACTIVITY_TYPE}::text, 'bdId', li.bd_id, 'name', li.name, 'at', li.at)
    end
    from (select 1) one
    left join (
      select activity.type, activity.actor_bd_id, (select b.name from bd b where b.id = activity.actor_bd_id) as name, ${effectiveActivityAtSql()} as at
      from ${activity}
      where activity.person_id = ${personId}
        and activity.actor_bd_id is not null
        and activity.type in (${sql.join(PREVIOUS_CONTACT_ACTIVITY_TYPES.map((type) => sql`${type}`), sql`, `)})
        and ${effectiveActivityAtSql()} is not null
      order by ${effectiveActivityAtSql()} desc, activity.id desc
      limit 1
    ) a on true
    left join (
      select pbc_pc.bd_id, (select b.name from bd b where b.id = pbc_pc.bd_id) as name, pbc_pc.last_message_at as at
      from person_bd_connection pbc_pc
      where pbc_pc.person_id = ${personId} and pbc_pc.sent_count > 0
      order by pbc_pc.last_message_at desc nulls last, pbc_pc.bd_id
      limit 1
    ) li on true
  )`;
}
