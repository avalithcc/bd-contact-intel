/**
 * Unit tests for src/lib/companies/searchCondition.ts (owner report
 * 2026-09-30: `/companies` had no text search at all).
 *
 * `companySearchCondition` is a pure SQL-condition builder — schema-only
 * import (`@/db/schema`), no `@/db`, no live DATABASE_URL needed (same
 * convention as tests/unit/roleVisibility.test.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { company } from "@/db/schema";
import { companySearchCondition } from "@/lib/companies/searchCondition";

const dialect = new PgDialect();

test("companySearchCondition: undefined/empty q adds no condition", () => {
  assert.equal(companySearchCondition(undefined), undefined);
  assert.equal(companySearchCondition(""), undefined);
  assert.equal(companySearchCondition("   "), undefined);
});

test("companySearchCondition: a single token matches display_name, domain or a company_alias row, via EXISTS (never a JOIN)", () => {
  const condition = companySearchCondition("nubiral");
  const { sql: text, params } = dialect.sqlToQuery(sql`select 1 from ${company} where ${condition}`);
  assert.match(text, /"display_name" ilike \$1/i);
  assert.match(text, /"domain" ilike \$2/i);
  assert.match(text, /exists \(/i);
  assert.match(text, /"company_alias"/i);
  assert.match(text, /"alias_key" ilike \$3/i);
  // EXISTS, never a JOIN against company_alias — a company with several
  // matching aliases must still produce exactly one row.
  assert.doesNotMatch(text, /join "company_alias"/i);
  assert.deepEqual(params, ["%nubiral%", "%nubiral%", "%nubiral%", "linkedin.com/%/%nubiral%"]);
});

test("companySearchCondition: wildcard characters in the term are escaped before going into the LIKE pattern", () => {
  const condition = companySearchCondition("100%_off\\");
  const { params } = dialect.sqlToQuery(sql`select 1 from ${company} where ${condition}`);
  assert.equal(params[0], "%100\\%\\_off\\\\%");
});

test("companySearchCondition: multiple whitespace-separated tokens are ANDed together (every token must match something)", () => {
  const condition = companySearchCondition("acme corp");
  const { sql: text, params } = dialect.sqlToQuery(sql`select 1 from ${company} where ${condition}`);
  assert.match(text, /\$1.*and.*\$4/is);
  assert.deepEqual(params, ["%acme%", "%acme%", "%acme%", "linkedin.com/%/%acme%", "%corp%", "%corp%", "%corp%", "linkedin.com/%/%corp%"]);
});

test("companySearchCondition: caps at 5 tokens (MAX_SEARCH_TOKENS, matching the /contacts convention)", () => {
  const condition = companySearchCondition("a b c d e f g");
  const { params } = dialect.sqlToQuery(sql`select 1 from ${company} where ${condition}`);
  // 4 params per bare token: displayName, domain, alias, LinkedIn slug.
  assert.equal(params.length, 5 * 4);
});
