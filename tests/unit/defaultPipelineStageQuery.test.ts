/**
 * Unit test for src/lib/companies/defaultPipelineStageQuery.ts. Pure query
 * builder — schema-only import, no `@/db`, no live DATABASE_URL needed
 * (same convention as effectiveActivityTime.ts).
 *
 * Regression for a prod-would-throw bug: an earlier version of this query
 * wrote `from activity a` and then referenced `a.person_id`, while
 * `effectiveActivityAtSql()` (src/lib/contacts/effectiveActivityTime.ts)
 * always renders fully-qualified `"activity"."type"` /
 * `"activity"."metadata"` / `"activity"."created_at"` — column references
 * pinned to the table's REAL name, not whatever local alias a caller
 * chooses. Aliasing `activity` as `a` hides the "activity" FROM-clause
 * entry from Postgres, so `"activity"."type"` fails with "invalid
 * reference to FROM-clause entry for table activity". This test renders
 * the actual query through drizzle's `PgDialect` (no DB connection) and
 * asserts every table that is referenced fully-qualified (by its real
 * name) is ALSO introduced in `FROM`/`JOIN` under that same real name,
 * unaliased — the general shape of the bug, not just the one instance.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildDefaultPipelineStageCandidatesQuery } from "@/lib/companies/defaultPipelineStageQuery";

const dialect = new PgDialect();

function renderSql(): string {
  return dialect.sqlToQuery(buildDefaultPipelineStageCandidatesQuery()).sql;
}

/** Every real table this query (or a helper it interpolates, like
 * effectiveActivityAtSql()) might reference fully-qualified. */
const REAL_TABLE_NAMES = ["activity", "person", "person_bd_connection", "company"];

/** Tokens that legitimately follow a bare `from "table"`/`join "table"`
 * without introducing an alias — the end of that clause, not an
 * identifier. Anything else immediately after the quoted table name is an
 * alias (`from "table" x` or `from "table" as x`). */
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

/** True if `renderedSql` introduces `table` in at least one `from`/`join`
 * clause with no alias — i.e. Postgres would resolve `"table".column`
 * against that very entry. */
function isTableEverIntroducedUnaliased(renderedSql: string, table: string): boolean {
  const introPattern = new RegExp(`(from|join)\\s+"${table}"(?:\\s+(as\\s+)?([a-zA-Z_]\\w*))?`, "gi");
  let match: RegExpExecArray | null;
  while ((match = introPattern.exec(renderedSql))) {
    const explicitAs = match[2];
    const nextToken = match[3];
    if (explicitAs) continue; // `from "table" as x` -> aliased, keep scanning
    if (!nextToken || NON_ALIAS_FOLLOWERS.has(nextToken.toLowerCase())) return true; // unaliased hit
  }
  return false;
}

test("effectiveActivityAtSql() renders its expected fully-qualified activity columns", () => {
  const renderedSql = renderSql();
  assert.match(renderedSql, /"activity"\."type"/);
  assert.match(renderedSql, /"activity"\."metadata"/);
  assert.match(renderedSql, /"activity"\."created_at"/);
});

for (const table of REAL_TABLE_NAMES) {
  test(`"${table}" is never aliased where it is also referenced fully-qualified by its real name`, () => {
    const renderedSql = renderSql();
    const qualifiedRefPattern = new RegExp(`"${table}"\\s*\\.`);
    if (!qualifiedRefPattern.test(renderedSql)) {
      // Never referenced fully-qualified anywhere — nothing to guard.
      return;
    }
    assert.ok(
      isTableEverIntroducedUnaliased(renderedSql, table),
      `"${table}" is referenced fully-qualified (by its real name) but every FROM/JOIN for it appears aliased — ` +
        `Postgres would reject the qualified reference with "invalid reference to FROM-clause entry"`,
    );
  });
}
