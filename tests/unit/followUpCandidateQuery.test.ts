/**
 * Unit test for src/lib/followUp/candidateQuery.ts. Pure query builder —
 * schema-only import, no `@/db`, no live DATABASE_URL needed (same
 * convention as tests/unit/defaultPipelineStageQuery.test.ts, which this
 * test file mirrors almost verbatim).
 *
 * Renders both queries through drizzle's `PgDialect` (no DB connection) and
 * asserts every table referenced fully-qualified (by its real name) is ALSO
 * introduced in FROM/JOIN under that same real name, unaliased — the exact
 * prod bug class defaultPipelineStageQuery.ts's own test guards against
 * (`from activity a` + `a.person_id` hides the "activity" FROM-clause entry
 * from Postgres, and `effectiveActivityAtSql()` always renders fully-
 * qualified `"activity"."col"`, pinned to the real table name).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { NO_PROGRESS_ACTIVITY_TYPES } from "@/lib/activity/noProgressActivity";
import { FOLLOW_UP_ACTIVITY_TYPES } from "@/lib/followUp/activityTypes";
import { buildFollowUpInsertQuery, buildFollowUpReentryQuery, buildFollowUpVerificationQuery } from "@/lib/followUp/candidateQuery";
import { FOLLOW_UP_DROP_ACTIVITY_TYPES } from "@/lib/followUp/activityTypes";
import { FOLLOW_UP_ENTRY_DAYS } from "@/lib/followUp/cycle";
import { carriedOpenItemSql } from "@/lib/followUp/openCycle";

const dialect = new PgDialect();

function renderInsert(): string {
  return dialect.sqlToQuery(buildFollowUpInsertQuery("00000000-0000-0000-0000-000000000001", "2026-09-29")).sql;
}

function renderVerification(): string {
  return dialect.sqlToQuery(buildFollowUpVerificationQuery()).sql;
}

const REAL_TABLE_NAMES = ["activity", "person", "person_bd_connection", "company"];

const NON_ALIAS_FOLLOWERS = new Set([
  "where",
  "group",
  "order",
  "having",
  "limit",
  "left",
  "right",
  "inner",
  "full",
  "cross",
  "join",
  "union",
]);

function isTableEverIntroducedUnaliased(renderedSql: string, table: string): boolean {
  const introPattern = new RegExp(`(from|join)\\s+"${table}"(?:\\s+(as\\s+)?([a-zA-Z_]\\w*))?`, "gi");
  let match: RegExpExecArray | null;
  while ((match = introPattern.exec(renderedSql))) {
    const explicitAs = match[2];
    const nextToken = match[3];
    if (explicitAs) continue;
    if (!nextToken || NON_ALIAS_FOLLOWERS.has(nextToken.toLowerCase())) return true;
  }
  return false;
}

for (const [label, render] of [
  ["buildFollowUpInsertQuery", renderInsert],
  ["buildFollowUpVerificationQuery", renderVerification],
] as const) {
  test(`${label}: effectiveActivityAtSql() renders its expected fully-qualified activity columns`, () => {
    const renderedSql = render();
    assert.match(renderedSql, /"activity"\."type"/);
    assert.match(renderedSql, /"activity"\."metadata"/);
    assert.match(renderedSql, /"activity"\."created_at"/);
  });

  for (const table of REAL_TABLE_NAMES) {
    test(`${label}: "${table}" is never aliased where it is also referenced fully-qualified by its real name`, () => {
      const renderedSql = render();
      const qualifiedRefPattern = new RegExp(`"${table}"\\s*\\.`);
      if (!qualifiedRefPattern.test(renderedSql)) return;
      assert.ok(
        isTableEverIntroducedUnaliased(renderedSql, table),
        `"${table}" is referenced fully-qualified but every FROM/JOIN for it appears aliased`,
      );
    });
  }
}

test("buildFollowUpInsertQuery: targets the idempotent-insert conflict key", () => {
  assert.match(renderInsert(), /on conflict \("?bd_id"?, ?"?queue_date"?, ?"?person_id"?\) do nothing/i);
});

test("buildFollowUpVerificationQuery: groups by owner and caps queue_count at the given limit", () => {
  const renderedSql = renderVerification();
  assert.match(renderedSql, /group by fuq_owner_bd_id/i);
  assert.match(renderedSql, /least\(count\(\*\), \$\d+\)/i);
});

test("buildFollowUpInsertQuery: excludes a person with a prior postponed/skipped row still snoozed past the queue date being computed", () => {
  const renderedSql = renderInsert();
  assert.match(renderedSql, /not exists\s*\(\s*select 1 from "follow_up_queue_item" fuq_prior/i);
  assert.match(renderedSql, /fuq_prior\.bd_id = \$\d+::uuid/i);
  assert.match(renderedSql, /fuq_prior\.person_id = fuq_due\.fuq_person_id/i);
  assert.match(renderedSql, /fuq_prior\.state in \('postponed', 'skipped'\)/i);
  assert.match(renderedSql, /fuq_prior\.snoozed_until > \$\d+::date/i);
});

for (const [label, render] of [
  ["buildFollowUpInsertQuery", renderInsert],
  ["buildFollowUpVerificationQuery", renderVerification],
] as const) {
  test(`${label}: aggregates the latest wrong-number call and drops a contact whose latest touch is that call`, () => {
    const renderedSql = render();
    // Aggregate lives in the pre-aggregated activity CTE, fully qualified.
    assert.match(
      renderedSql,
      /max\(case when activity\.type = 'call'\s+and activity\.metadata ->> 'outcome' = 'wrong_number'\s+then[\s\S]*? end\) as fuq_wrong_number_at/i,
    );
    // Carried through the candidate CTE, then filtered in fuq_due.
    assert.match(renderedSql, /fuq_activity\.fuq_wrong_number_at as fuq_wrong_number_at/i);
    assert.match(
      renderedSql,
      /not \(fuq_wrong_number_at is not null and fuq_wrong_number_at >= fuq_last_touch\)/i,
    );
  });
}

test("buildFollowUpInsertQuery: renders identically on repeated calls (no shared mutable state)", () => {
  assert.equal(renderInsert(), renderInsert());
});

// An unanswered dial must not reset the cadence clock (owner decision, call-logging W5).
// The clock's `where` is the only place that list is bound, and its value is the shared
// list: ONLY call_attempt, lusha_reveal and auto_reply_received, so a call, a reply and a status change still move the clock.
test("fuq_activity excludes exactly the shared no-progress types from the last-touch clock", () => {
  const { sql: text, params } = dialect.sqlToQuery(buildFollowUpVerificationQuery());
  const cte = text.slice(text.indexOf("fuq_activity as ("), text.indexOf("fuq_connection as ("));
  const match = cte.match(/activity\.type not in \(([^)]*)\)/);
  assert.ok(match, "the clock filters by type");
  const bound = match![1]!.split(",").map((p) => params[Number(p.trim().slice(1)) - 1]);
  assert.deepEqual(bound, [...NO_PROGRESS_ACTIVITY_TYPES]);
  assert.deepEqual(bound, ["call_attempt", "lusha_reveal", "auto_reply_received", "email_bounced", ...FOLLOW_UP_ACTIVITY_TYPES]);
});

// follow-up-expiry: one entry threshold for both statuses, from the exported constant (owner decision 2026-10-27).
test("the entry rule is five days for Respondió and Contactado alike, with no per-status threshold left", () => {
  const text = renderVerification();
  assert.equal(text.match(/interval '5 days'/g)?.length, 1);
  assert.doesNotMatch(text, /interval '3 days'|interval '7 days'/);
  assert.equal(FOLLOW_UP_ENTRY_DAYS, 5);
});

test("a dropped contact and a contact with an open cycle are kept out of the new entries", () => {
  const { sql: text, params } = dialect.sqlToQuery(buildFollowUpVerificationQuery());
  const due = text.slice(text.indexOf("fuq_due as ("));
  assert.match(due, /activity\.created_at > fuq_last_touch/);
  assert.ok(FOLLOW_UP_DROP_ACTIVITY_TYPES.every((t) => params.includes(t)));
  assert.match(due, /fuq_cycle\.cycle_started_on is not null\s+and fuq_cycle\.last_touch_at >= fuq_last_touch/);
});

test("the insert opens a cycle on its own queue date and gives the cap to days 1-2 carried items only", () => {
  const text = renderInsert();
  assert.match(text, /\(bd_id, queue_date, person_id, position, due_status, last_touch_at, cycle_started_on\)/);
  assert.match(text, /fuq_selected\.fuq_last_touch, \$\d+::date\s+from/);
  assert.match(text, /limit greatest\(\$\d+ - \(\s*select count\(\*\) from follow_up_queue_item/);
  assert.match(text, /follow_up_queue_item\.cycle_started_on > \$\d+::date - \$\d+::int\s*\)/);
});

test("the pre-migration measurement variant never mentions cycle_started_on; every default render does", () => {
  const measured = dialect.sqlToQuery(buildFollowUpVerificationQuery(10, { includeCycles: false })).sql;
  assert.doesNotMatch(measured, /cycle_started_on/);
  assert.match(measured, /interval '5 days'/, "same entry rule");
  assert.match(renderVerification(), /cycle_started_on/);
  assert.match(renderInsert(), /cycle_started_on/);
});

test("the re-entry statement fires only while the latest follow-up activity is a drop", () => {
  const { sql: text, params } = dialect.sqlToQuery(buildFollowUpReentryQuery("00000000-0000-0000-0000-000000000001", "2026-10-27"));
  assert.match(text, /insert into "activity" \(person_id, type, metadata\)/);
  assert.match(text, /order by last_event\.created_at desc\s+limit 1/);
  assert.ok(params.includes("follow_up_reentered"));
  assert.match(text, /\) in \(\$\d+, \$\d+\)\s*$/);
});

test("the open-cycle predicate reads every table through its schema object and ends a cycle on a touch or a drop", () => {
  const { sql: text, params } = dialect.sqlToQuery(carriedOpenItemSql("00000000-0000-0000-0000-000000000001", "2026-10-27"));
  for (const table of ["person", "activity", "person_bd_connection"]) assert.match(text, new RegExp(`from "${table}"`));
  assert.doesNotMatch(text, /from "(person|activity|person_bd_connection)" [a-z_]+\s/);
  assert.match(text, /person_bd_connection\.last_message_at > follow_up_queue_item\.last_touch_at/);
  assert.match(text, /activity\.created_at >= follow_up_queue_item\.created_at/);
  for (const t of [...NO_PROGRESS_ACTIVITY_TYPES, ...FOLLOW_UP_DROP_ACTIVITY_TYPES]) assert.ok(params.includes(t), t);
});

test("the open-cycle predicate renders identically on repeated calls", () => {
  const render = () => dialect.sqlToQuery(carriedOpenItemSql("00000000-0000-0000-0000-000000000001", "2026-10-27"));
  assert.deepEqual(render(), render());
});
