import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { buildFollowUpInsertQuery } from "@/lib/followUp/candidateQuery";
import { notActiveClientCompanySql } from "@/lib/followUp/activeClientExclusion";

const dialect = new PgDialect();

test("the exclusion binds only 'active' (inactive and null stay) and correlates on the given company key", () => {
  const q = dialect.sqlToQuery(notActiveClientCompanySql(sql`person.company_key`));
  assert.match(q.sql, /not exists/);
  assert.match(q.sql, /company\.company_key = person\.company_key/);
  assert.deepEqual(q.params, ["active"]);
});

test("the insert query carries the shared exclusion", () => {
  const q = dialect.sqlToQuery(buildFollowUpInsertQuery("00000000-0000-0000-0000-000000000001", "2026-10-26"));
  assert.match(q.sql, /company\.client_status = \$\d+/);
  assert.ok(q.params.includes("active"));
});
