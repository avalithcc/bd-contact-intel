/**
 * The `/companies` list and the company record must show the same contact
 * count. The record's reads (`getCompanyPeople`, `getCompanyPersonIds`,
 * `getCompanyContactCount`) all exclude merged-away people; the list's
 * batched count did not, so 261 companies showed a different number on the
 * list than on their own record (measured read-only against production
 * 2026-10-09: 328 merged-away person rows still carrying a company_key).
 * Db-free: the query renders through a QueryBuilder.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryBuilder } from "drizzle-orm/pg-core";
import type { db } from "@/db";
import { companyContactCountsQuery } from "@/lib/companies/contactCounts";

function render(keys: string[]) {
  const qb = new QueryBuilder() as unknown as Pick<typeof db, "select">;
  return companyContactCountsQuery(qb, keys).toSQL();
}

test("the list's contact count excludes merged-away people, like the record does", () => {
  const { sql } = render(["acme", "globex"]);
  assert.match(sql, /"person"\."merged_into_id" is null/i);
});

test("the count stays one grouped query bound to exactly the page's keys", () => {
  const { sql, params } = render(["acme", "globex"]);
  assert.match(sql, /"person"\."company_key" in \(\$1, \$2\)/);
  assert.match(sql, /group by "person"\."company_key"$/);
  assert.deepEqual(params, ["acme", "globex"]);
});
