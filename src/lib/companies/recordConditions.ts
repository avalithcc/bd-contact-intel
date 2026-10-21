import { and, eq, inArray, or } from "drizzle-orm";
import { activity, task } from "@/db/schema";
import { notFoldedAttemptSql } from "@/lib/activity/callAttemptFold";

/**
 * The company record's WHERE builders that take the resolved person-id list.
 * Schema-only imports (no `@/db`) so the compiled SQL is unit-testable. Pure:
 * the id list is read, never mutated.
 *
 * An empty list cannot be `IN ()` (invalid SQL), so it drops the person branch
 * and leaves the company-row condition alone.
 */

/**
 * The Activity tab's base WHERE, shared by the rows and the counts. A soft-deleted Contact note STAYS in the rows (the tab
 * renders a tombstone, never a gap) with its text withheld by buildCompanyTimelineEntry; the counts exclude it.
 */
export function companyTimelineBaseWhere(companyKey: string, personIds: readonly string[]) {
  const subject = personIds.length
    ? or(eq(activity.companyKey, companyKey), inArray(activity.personId, [...personIds]))
    : eq(activity.companyKey, companyKey);
  return and(subject, notFoldedAttemptSql());
}

/** "Tareas abiertas": open tasks on the company itself or on any of its people. */
export function companyOpenTasksCondition(companyKey: string, personIds: readonly string[]) {
  return and(
    eq(task.status, "open"),
    personIds.length ? or(eq(task.companyKey, companyKey), inArray(task.personId, [...personIds])) : eq(task.companyKey, companyKey),
  );
}
