/**
 * The one search rule (src/lib/search/accentInsensitive.ts): a term matches a text when, ignoring case AND accents on
 * BOTH sides, the text contains it. These tests pin the JS twin and the SQL shape; tests/db/accentInsensitiveSearch.test.ts
 * runs the same ACCENT_CASES through Postgres `unaccent` so the two cannot drift.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  containsPattern,
  escapeLikeWildcards,
  foldAccents,
  foldedIlike,
  foldedIncludes,
  termContainsSql,
} from "@/lib/search/accentInsensitive";
import { ACCENT_CASES } from "../fixtures/accentCases";

const dialect = new PgDialect();

test("foldedIncludes: jose finds JOSE, Jose and José, and the reverse", () => {
  for (const text of ["JOSE", "Jose", "José"]) assert.equal(foldedIncludes(text, "jose"), true, text);
  assert.equal(foldedIncludes("jose", "José"), true);
});

test("foldedIncludes: table of Latin accent cases", () => {
  for (const [text, term, expected] of ACCENT_CASES) assert.equal(foldedIncludes(text, term), expected, `${text} / ${term}`);
});

test("foldedIncludes: a null or undefined text never matches", () => {
  assert.equal(foldedIncludes(null, "a"), false);
  assert.equal(foldedIncludes(undefined, "a"), false);
});

test("foldAccents keeps ASCII punctuation that Unicode marks as a diacritic (^ and `)", () => {
  assert.equal(foldAccents("a^b`c"), "a^b`c");
  assert.equal(foldAccents("é"), "e"); // decomposed input folds too
});

test("foldedIncludes treats % and _ as literal characters, like the escaped SQL pattern", () => {
  assert.equal(foldedIncludes("100% José", "100%"), true);
  assert.equal(foldedIncludes("abc", "%"), false);
  assert.equal(foldedIncludes("abc", "_"), false);
});

test("escapeLikeWildcards escapes %, _ and the escape character", () => {
  assert.equal(escapeLikeWildcards("100%_off\\"), "100\\%\\_off\\\\");
  assert.equal(containsPattern("a%b"), "%a\\%b%");
});

test("foldedIlike folds the column and the pattern", () => {
  const q = dialect.sqlToQuery(sql`select 1 where ${foldedIlike(sql`name`, "%José%")}`);
  assert.equal(q.sql, "select 1 where unaccent(name) ilike unaccent($1)");
  assert.deepEqual(q.params, ["%José%"]);
});

test("termContainsSql builds the escaped contains pattern, so a typed % is not a wildcard", () => {
  const q = dialect.sqlToQuery(sql`select 1 where ${termContainsSql(sql`name`, "50%")}`);
  assert.equal(q.sql, "select 1 where unaccent(name) ilike unaccent($1)");
  assert.deepEqual(q.params, ["%50\\%%"]);
});

test("the helper keeps no state between calls: the same input renders the same query twice", () => {
  const a = dialect.sqlToQuery(sql`${termContainsSql(sql`n`, "x")}`);
  const b = dialect.sqlToQuery(sql`${termContainsSql(sql`n`, "x")}`);
  assert.deepEqual(a, b);
});
