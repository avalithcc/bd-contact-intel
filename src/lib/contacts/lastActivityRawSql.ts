import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { activity } from "@/db/schema";
import { LINKEDIN_LAST_ACTIVITY_TYPE } from "@/lib/contacts/lastActivity";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";

/**
 * The ONE definition of the "Última actividad" correlated subquery: the single
 * most recent touch of one person as `{ type, metadata, createdAt }` JSON (the
 * `InlineLastActivityRaw` shape of inlineDerivedColumns.ts). Shared by the
 * contacts list (`pcl_page.id`) and the Outreach view (`person.id`) so the two
 * can never disagree on which activity is "the last one".
 *
 * A scalar subquery on purpose: one value per outer row, so it cannot fan out
 * an enclosing GROUP BY / sum(). Ordered by the effective activity time (NOT
 * `created_at`), `nulls last` so a non-touch row never beats a real touch,
 * `activity.id desc` as a tiebreak.
 *
 * `activity.person_id` is literal SQL, not `${activity.personId}`: drizzle
 * re-emits an earlier bare rendering of the same column reference and turned
 * the predicate into the always-false `"person_id" = "id"` (see listQueries.ts).
 *
 * @param personId the outer query's person id expression
 */
export function lastActivityRawSql(personId: SQLWrapper): SQL {
  // NEWEST WINS between the newest touch and the LinkedIn connection date; an
  // exact tie goes to the activity (a specific fact beats a coarse aggregate
  // with no direction). INVARIANT: the `createdAt` returned here equals
  // lastContactAtSql() (`lastMessageAt`) for the same person, both being
  // greatest(newest touch, LinkedIn date): one value, two renderings. The
  // `is not null` filter drops non-touch rows, so a person whose only rows
  // are non-touch resolves to LinkedIn. LinkedIn direction is unknown, hence
  // the unqualified label (see resolveLastActivity in lastActivity.ts).
  return sql`(
    select case
      when a.at is not null and (li.at is null or a.at >= li.at)
        then json_build_object('type', a.type, 'metadata', a.metadata, 'createdAt', a.at)
      when li.at is not null
        then json_build_object('type', ${LINKEDIN_LAST_ACTIVITY_TYPE}::text, 'metadata', null, 'createdAt', li.at)
    end
    from (select 1) one
    left join (
      select activity.type, activity.metadata, ${effectiveActivityAtSql()} as at
      from ${activity}
      where activity.person_id = ${personId} and ${effectiveActivityAtSql()} is not null
      order by ${effectiveActivityAtSql()} desc, activity.id desc
      limit 1
    ) a on true
    left join (
      select max(pbc_li.last_message_at) as at
      from person_bd_connection pbc_li
      where pbc_li.person_id = ${personId}
    ) li on true
  )`;
}
