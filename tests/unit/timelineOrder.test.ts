/**
 * Unit test for src/lib/activity/timelineOrder.ts. Pure query-fragment
 * builder — schema-only import, no `@/db`, no live DATABASE_URL needed
 * (same convention as tests/unit/followUpCandidateQuery.test.ts).
 *
 * Fresh-review fix: getPersonTimeline/getCompanyTimeline used to order by
 * `effectiveActivityAtSql() DESC NULLS LAST`, which pushes every non-touch
 * row (task_updated/task_completed/task_reopened) to the very bottom — a
 * busy record's bounded `LIMIT` would then cut them entirely, even though
 * the owner explicitly requires task edits to stay visible in the
 * timeline. The fix orders by DISPLAY time instead:
 * `coalesce(effectiveActivityAtSql(), activity.created_at) DESC` — no
 * `NULLS LAST` at all, since `coalesce` never produces a NULL to push down.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { timelineOrderBySql } from "@/lib/activity/timelineOrder";

const dialect = new PgDialect();

test("timelineOrderBySql(): renders coalesce(effective_time, created_at) desc, never NULLS LAST", () => {
  const { sql } = dialect.sqlToQuery(timelineOrderBySql());
  assert.match(sql, /^coalesce\(\(case/i);
  assert.match(sql, /"activity"\."created_at"\) desc$/i);
  assert.doesNotMatch(sql, /nulls last/i);
});

test('timelineOrderBySql(): "activity" is referenced fully-qualified inside the CASE (effectiveActivityAtSql) and as the coalesce fallback', () => {
  const { sql } = dialect.sqlToQuery(timelineOrderBySql());
  assert.match(sql, /"activity"\."type"/);
  assert.match(sql, /"activity"\."created_at"/);
});
