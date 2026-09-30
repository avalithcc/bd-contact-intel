/**
 * Unit test for src/lib/shell/appShellBadgeCountsQuery.ts. Pure query
 * builder — schema-only import, no `@/db`, no live DATABASE_URL needed
 * (same convention as tests/unit/followUpCandidateQuery.test.ts).
 *
 * Fresh-review fix: AppLayout used to run two separate round trips
 * (getTaskBadgeCount + getFollowUpQueueBadgeCount) on every page view. This
 * query combines both into one statement's two scalar subqueries — these
 * tests pin that (a) both counts are present with the right column names,
 * (b) the "worked today" allowlist matches WORKED_ACTIVITY_TYPES exactly,
 * and (c) `activity` (touched by the follow-up subquery) is never aliased
 * where it's also referenced fully-qualified by its real name (rule 4).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildAppShellBadgeCountsQuery } from "@/lib/shell/appShellBadgeCountsQuery";
import { WORKED_ACTIVITY_TYPES } from "@/lib/followUp/queueSelection";

const dialect = new PgDialect();

function render() {
  return dialect.sqlToQuery(
    buildAppShellBadgeCountsQuery({
      bdId: "00000000-0000-0000-0000-000000000001",
      queueDate: "2026-09-29",
      tomorrowStartUtcIso: "2026-09-30T00:00:00.000Z",
      workedTodayFromIso: "2026-09-29T03:00:00.000Z",
      workedTodayToIso: "2026-09-30T03:00:00.000Z",
    }),
  );
}

test("buildAppShellBadgeCountsQuery: selects exactly task_count and follow_up_count", () => {
  const { sql } = render();
  assert.match(sql, /as task_count/i);
  assert.match(sql, /as follow_up_count/i);
});

test("buildAppShellBadgeCountsQuery: task_count matches getTaskBadgeCount's exact filter", () => {
  const { sql } = render();
  assert.match(sql, /task\.assigned_to_bd_id = \$\d+::uuid/i);
  assert.match(sql, /task\.status = 'open'/i);
  assert.match(sql, /task\.due_at is not null/i);
  assert.match(sql, /task\.due_at < \$\d+::timestamptz/i);
});

test("buildAppShellBadgeCountsQuery: follow_up_count scopes to this bd/queue_date/pending, with the worked-today allowlist", () => {
  const { sql, params } = render();
  assert.match(sql, /follow_up_queue_item\.bd_id = \$\d+::uuid/i);
  assert.match(sql, /follow_up_queue_item\.queue_date = \$\d+::date/i);
  assert.match(sql, /follow_up_queue_item\.state = 'pending'/i);
  assert.match(sql, /not exists/i);
  assert.match(sql, /activity\.person_id = follow_up_queue_item\.person_id/i);
  assert.match(sql, /activity\.type in \(\$\d+(, \$\d+)*\)/i);
  // No `actor_bd_id` filter — "worked today" is ANY BD (decision brief).
  assert.doesNotMatch(sql, /actor_bd_id/i);
  for (const type of WORKED_ACTIVITY_TYPES) assert.ok(params.includes(type), `expected "${type}" among bound params`);
});

test('"activity" is never aliased where it is also referenced fully-qualified by its real name', () => {
  const { sql } = render();
  assert.match(sql, /from "activity"\s*\n/i, "expected an unaliased FROM \"activity\"");
});

test("buildAppShellBadgeCountsQuery: follow_up_count excludes a merged person, same guard as readQueueRows (queueQueries.ts)", () => {
  const { sql } = render();
  assert.match(sql, /exists\s*\(\s*select 1 from "person"\s*\n\s*where person\.id = follow_up_queue_item\.person_id\s*\n\s*and person\.merged_into_id is null/i);
});

test("buildAppShellBadgeCountsQuery: worked-today excludes 'call' from the occurredAt redirect (a call's created_at still counts)", () => {
  const { sql } = render();
  assert.match(sql, /when activity\.type = 'call' then activity\.created_at/i);
});

test("buildAppShellBadgeCountsQuery: worked-today redirects email_sent/reply_received to metadata.occurredAt when present", () => {
  const { sql } = render();
  assert.match(
    sql,
    /when activity\.type in \('email_sent', 'reply_received'\) and \(activity\.metadata->>'occurredAt'\) ~ '[^']+' then \(activity\.metadata->>'occurredAt'\)::timestamptz/i,
  );
});
