import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { lushaReveal } from "../../src/db/schema";

const UP = "drizzle/0043_lusha_reveal.sql";
const DOWN = "drizzle/0043_lusha_reveal_rollback.sql";
const strip = (sql: string) => sql.replace(/--[^\n]*/g, "");

test("the lusha_reveal migration and its rollback twin exist", () => {
  assert.ok(existsSync(UP), `${UP} missing`);
  assert.ok(existsSync(DOWN), `${DOWN} missing`);
});

test("the migration declares every column of the schema mirror", () => {
  const sql = strip(readFileSync(UP, "utf8"));
  const { columns } = getTableConfig(lushaReveal);
  for (const c of columns) assert.match(sql, new RegExp(`"${c.name}"`), `column ${c.name} missing from ${UP}`);
});

test("the carry-over columns the revealState resolver and the cap depend on exist", () => {
  const names = getTableConfig(lushaReveal).columns.map((c) => c.name);
  for (const n of ["search_id", "at", "credits_charged", "credits_reserved", "payload", "state", "outcome"]) {
    assert.ok(names.includes(n), `${n} missing`);
  }
});

test("the only unique index is partial on in-flight rows", () => {
  const sql = strip(readFileSync(UP, "utf8"));
  const uniques = [...sql.matchAll(/CREATE UNIQUE INDEX[^;]*;/gi)].map((m) => m[0]);
  assert.equal(uniques.length, 1, "exactly one unique index");
  assert.match(uniques[0], /\("person_id","field"\)\s+WHERE\s+"lusha_reveal"\."state" = 'reserved'/);
  assert.doesNotMatch(sql, /UNIQUE\s*\(/i, "no table-level UNIQUE constraint");
});

test("the latest-row index is (person_id, field, at desc)", () => {
  assert.match(readFileSync(UP, "utf8"), /\("person_id","field","at" desc\)/);
});

test("RLS is enabled with no policies", () => {
  const sql = strip(readFileSync(UP, "utf8"));
  assert.match(sql, /ALTER TABLE "public"\."lusha_reveal" ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
});

test("the rollback drops only lusha_reveal", () => {
  const sql = strip(readFileSync(DOWN, "utf8")).trim();
  assert.equal(sql, 'DROP TABLE IF EXISTS "lusha_reveal";');
});
