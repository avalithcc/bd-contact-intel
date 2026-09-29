/**
 * Every table created by a migration must have Row Level Security enabled
 * by some migration.
 *
 * Until 2026-09-29 no public table had RLS, and the `anon` role — whose key
 * ships in the browser bundle — could read, modify and delete all 31 of them
 * through PostgREST without signing in. `drizzle/0019_enable_rls.sql` closed
 * that. This test keeps the next `CREATE TABLE` from quietly reopening it:
 * the app connects as the table owner with BYPASSRLS, so forgetting RLS on a
 * new table breaks nothing visible — it only exposes the data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "drizzle";
const sqlFiles = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
// SQL line comments are stripped first: several migrations explain themselves
// in comments that quote `CREATE TABLE IF NOT EXISTS`, which is not DDL.
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");
const all = sqlFiles.map((f) => stripComments(readFileSync(join(DIR, f), "utf8"))).join("\n");

const unquote = (name: string) => name.replace(/"/g, "").replace(/^public\./, "");

test("every table created by a migration has RLS enabled by some migration", () => {
  const created = new Set(
    [...all.matchAll(/CREATE TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?public"?\.)?"?\w+"?)/gi)].map((m) => unquote(m[1])),
  );
  const protectedTables = new Set(
    [...all.matchAll(/ALTER TABLE\s+((?:"?public"?\.)?"?\w+"?)\s+ENABLE ROW LEVEL SECURITY/gi)].map((m) => unquote(m[1])),
  );
  const missing = [...created].filter((t) => !protectedTables.has(t)).sort();
  assert.deepEqual(missing, [], `tables without RLS — add ALTER TABLE ... ENABLE ROW LEVEL SECURITY:\n${missing.join("\n")}`);
});

test("the scan sees the tables it should (guards against a silently broken regex)", () => {
  const created = [...all.matchAll(/CREATE TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?public"?\.)?"?\w+"?)/gi)];
  assert.ok(created.length >= 25, `expected the existing schema's CREATE TABLEs, found ${created.length}`);
});
