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
