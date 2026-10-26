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
  // Precedence: a real touch wins; the LinkedIn connection date is the
  // fallback only when no touch exists (the `is not null` filter also drops a
  // person whose only rows are non-touch). Direction is unknown for LinkedIn,
  // hence the unqualified label (see resolveLastActivity in lastActivity.ts).
  return sql`coalesce((
    select json_build_object(
      'type', activity.type,
      'metadata', activity.metadata,
      'createdAt', ${effectiveActivityAtSql()}
    )
    from ${activity}
    where activity.person_id = ${personId} and ${effectiveActivityAtSql()} is not null
    order by ${effectiveActivityAtSql()} desc, activity.id desc
    limit 1
  ), (
    select json_build_object('type', ${LINKEDIN_LAST_ACTIVITY_TYPE}::text, 'metadata', null, 'createdAt', li.last_at)
    from (
      select max(pbc_li.last_message_at) as last_at
      from person_bd_connection pbc_li
      where pbc_li.person_id = ${personId}
    ) li
    where li.last_at is not null
  ))`;
}
