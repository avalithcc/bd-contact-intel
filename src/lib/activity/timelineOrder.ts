/**
 * Shared timeline `ORDER BY` — DISPLAY time, not "last touch" time. A
 * timeline (getPersonTimeline, activity/queries.ts; getCompanyTimeline,
 * companies/recordQueries.ts) must order every row by
 * `coalesce(effectiveActivityAtSql(), activity.created_at) DESC`, never
 * `... DESC NULLS LAST`: `NULLS LAST` would push every non-touch row
 * (the ALL_TASK_ACTIVITY_TYPES task types — effective time NULL) to the
 * very bottom, and a busy record's bounded `LIMIT` would then cut them
 * entirely — but the owner explicitly requires task edits to stay visible
 * in the timeline. `coalesce(...)` orders each row by exactly what
 * `buildTimelineEntry`/`buildCompanyTimelineEntry` display for it (same
 * fallback to `created_at`), so a same-day task edit sorts where it
 * actually happened, never shoved to the bottom.
 *
 * This is the OPPOSITE rule from every "last touch" picker (listQueries.ts's
 * DISTINCT ON/`lastActivityAgg`, the `lastActivityDays` staleness filter,
 * `candidateQuery.ts`'s follow-up eligibility) — those must keep excluding
 * non-touch rows from winning the "most recent touch" pick (`NULLS LAST` or
 * an aggregate that naturally ignores `NULL`). A timeline is not one of
 * those; it renders every row, it doesn't pick a single "last touch".
 *
 * Schema-only import (no `@/db` client), shared by both timeline callers so
 * they can never drift from each other on this rule — same convention as
 * every other pure query-fragment builder in this codebase.
 */
import { sql } from "drizzle-orm";
import { activity } from "@/db/schema";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";

export function timelineOrderBySql() {
  return sql`coalesce(${effectiveActivityAtSql()}, ${activity.createdAt}) desc`;
}
