/**
 * /admin/duplicates queue order: pairs where either side has activity first,
 * then newest first, then `id` so the order is total. Db-free: rendered
 * through a QueryBuilder / PgDialect, like companyLastActivitySignal.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect, QueryBuilder } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { duplicateCandidate, person } from "@/db/schema";
import {
  duplicateQueueHasActivity,
  duplicateQueueOrderBy,
} from "@/lib/identity/duplicateQueueOrder";

function renderQueue() {
  return new QueryBuilder()
    .select({ id: duplicateCandidate.id, hasActivity: duplicateQueueHasActivity().as("has_activity") })
    .from(duplicateCandidate)
    // Same join shape as the real query: with a join drizzle qualifies every column.
    .innerJoin(person, eq(person.id, duplicateCandidate.personAId))
    .orderBy(...duplicateQueueOrderBy())
    .toSQL();
}

test("activity predicate is a correlated EXISTS over both sides, not a join", () => {
  const { sql } = renderQueue();
  assert.match(
    sql,
    /exists \(select 1 from "activity" where "activity"."person_id" in \("duplicate_candidate"."person_a_id", "duplicate_candidate"."person_b_id"\)\) as "has_activity"/i,
  );
  assert.doesNotMatch(sql, /join "activity"/i);
});

// Postgres sorts false < true, so `exists(...) desc` puts pairs WITH activity first.
test("order: activity first, created_at desc, then id as the total tiebreak", () => {
  const { sql } = renderQueue();
  assert.match(
    sql,
    /order by exists \(select 1 from "activity" where .*\) desc, "duplicate_candidate"."created_at" desc, "duplicate_candidate"."id" asc$/i,
  );
});

test("duplicateQueueOrderBy is pure: two calls render identically", () => {
  const d = new PgDialect();
  const a = duplicateQueueOrderBy().map((s) => d.sqlToQuery(s).sql);
  const b = duplicateQueueOrderBy().map((s) => d.sqlToQuery(s).sql);
  assert.deepEqual(a, b);
});
