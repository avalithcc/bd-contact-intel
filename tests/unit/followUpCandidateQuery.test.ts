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
import { buildFollowUpInsertQuery, buildFollowUpVerificationQuery } from "@/lib/followUp/candidateQuery";

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
