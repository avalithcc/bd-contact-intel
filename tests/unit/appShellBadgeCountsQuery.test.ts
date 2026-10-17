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

function render(isAdmin = false) {
  return dialect.sqlToQuery(
    buildAppShellBadgeCountsQuery({
      bdId: "00000000-0000-0000-0000-000000000001",
      queueDate: "2026-09-29",
      tomorrowStartUtcIso: "2026-09-30T00:00:00.000Z",
      workedTodayFromIso: "2026-09-29T03:00:00.000Z",
      workedTodayToIso: "2026-09-30T03:00:00.000Z",
      isAdmin,
    }),
  );
}

test("buildAppShellBadgeCountsQuery: selects exactly task_count and follow_up_count", () => {
  const { sql } = render();
  assert.match(sql, /as task_count/i);
  assert.match(sql, /as follow_up_count/i);
});

test("buildAppShellBadgeCountsQuery: queue_built is a cheap exists on today's queue rows for this bd (F5)", () => {
  const { sql } = render();
  assert.match(
    sql,
    /exists\s*\(\s*select 1 from "follow_up_queue_item"\s+where follow_up_queue_item\.bd_id = \$\d+::uuid\s+and follow_up_queue_item\.queue_date = \$\d+::date\s*\)\s+as queue_built/i,
  );
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

test("buildAppShellBadgeCountsQuery: absorption_count counts open proposals team-wide (no bd filter)", () => {
  const { sql } = render();
  const match = sql.match(/select count\(\*\)::int\s+from "company_absorption_proposal"[\s\S]*?\)\s+as absorption_count/i);
  assert.ok(match, "expected an absorption_count scalar subquery over company_absorption_proposal");
  assert.match(match[0], /company_absorption_proposal\.status = 'open'/i);
  assert.doesNotMatch(match[0], /bd_id|\$\d+::uuid/i);
});

test("buildAppShellBadgeCountsQuery: duplicate_count counts open duplicate candidates team-wide for admins", () => {
  const { sql } = render(true);
  const match = sql.match(/select count\(\*\)::int\s+from "duplicate_candidate"[\s\S]*?\)\s+as duplicate_count/i);
  assert.ok(match, "expected a duplicate_count scalar subquery over duplicate_candidate");
  assert.match(match[0], /duplicate_candidate\.status = 'open'/i);
  assert.doesNotMatch(match[0], /bd_id|\$\d+::uuid/i);
});

test("buildAppShellBadgeCountsQuery: non-admins get a literal 0 and never touch duplicate_candidate", () => {
  const { sql } = render(false);
  assert.match(sql, /0\s+as duplicate_count/i);
  assert.doesNotMatch(sql, /duplicate_candidate/i);
});

// Task 13.6: the sidebar's Secuencias pill rides the same single statement as the other badges.
test("buildAppShellBadgeCountsQuery: sequence_count counts THIS bd's sequences that still have a live member", () => {
  const { sql, params } = render();
  const match = sql.match(/select count\(\*\)::int\s+from "sequence"[\s\S]*?\)\s+as sequence_count/i);
  assert.ok(match, "expected a sequence_count scalar subquery over sequence");
  assert.match(match[0], /sequence\.owner_bd_id = \$\d+::uuid/i);
  assert.match(match[0], /exists\s*\(\s*select 1 from "sequence_member"/i);
  assert.match(match[0], /sequence_member\.sequence_id = sequence\.id/i);
  assert.match(match[0], /sequence_member\.state not in \(\$\d+, \$\d+, \$\d+\)/i);
  for (const state of ["replied", "no_reply", "discarded"]) assert.ok(params.includes(state), state);
  for (const live of ["drafted", "approved", "sent"]) assert.ok(!params.includes(live), `${live} must count as live`);
});

test("buildAppShellBadgeCountsQuery: the sequence badge adds a column, not a round trip", () => {
  const { sql } = render();
  assert.ok(sql.trim().toLowerCase().startsWith("select"), "one statement");
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /;/, "no second statement");
  assert.match(sql, /as sequence_count/i);
});

test("buildAppShellBadgeCountsQuery: scheduled_count is this BD's scheduled, on_hold and failed emails (scheduled-send)", () => {
  const { sql } = render();
  assert.match(
    sql,
    /select count\(\*\)::int\s+from "scheduled_email"\s+where scheduled_email\.bd_id = \$\d+::uuid\s+and scheduled_email\.status in \('scheduled', 'on_hold', 'failed'\)\s*\) as scheduled_count/i,
  );
});
