import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { activity } from "@/db/schema";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";

/**
 * "Last contact" of one person, of ANY kind: the newer of their latest touch in
 * `activity` (an email, a LinkedIn message, a call attempt, a logged meeting;
 * task bookkeeping, meeting scheduling and soft-deleted notes are NULL in
 * `effectiveActivityAtSql()`, that is the project's own definition of a touch) and the LinkedIn date from
 * `person_bd_connection`. `person_bd_connection.last_message_at` alone is
 * LinkedIn-only: on 2026-10-26, 311 of 318 people with email history had an
 * understated last contact.
 *
 * A correlated scalar subquery on purpose: it yields one value per person, so it
 * cannot multiply the `sum(message_count)` of the aggregate query it sits in.
 * Postgres `greatest()` ignores NULLs (it is NULL only when every argument is),
 * so activity-only and LinkedIn-only people both resolve.
 *
 * @param personId the outer query's person id column
 * @param linkedinLastAt the already-aggregated LinkedIn last-message timestamp
 */
export function lastContactAtSql(personId: SQLWrapper, linkedinLastAt: SQLWrapper): SQL {
  return sql`greatest((select max(${effectiveActivityAtSql()}) from ${activity} where ${activity.personId} = ${personId}), ${linkedinLastAt})`;
}
