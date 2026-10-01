/**
 * `npm run db:generate` omits BOTH `SET LOCAL lock_timeout` and the
 * `USING "<col>" AT TIME ZONE 'UTC'` clause on every timestamptz slice, so
 * each slice must be hand-corrected. Neither the journal test nor the
 * snapshot drift test can see a file missing them; this one pins the SQL.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const DRIZZLE_DIR = join(process.cwd(), "drizzle");
const SLICE_RE = /^00\d\d_timestamptz_slice_\d+(_rollback)?\.sql$/;

// Matches one ALTER ... SET DATA TYPE <type> [USING "<col>" AT TIME ZONE 'UTC'];
const ALTER_RE =
  /ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" SET DATA TYPE (timestamp with time zone|timestamp)\b([^;]*);/g;

interface AlterStatement {
  table: string;
  column: string;
  type: string;
  tail: string;
}

function parseAlters(sql: string): AlterStatement[] {
  return [...sql.matchAll(ALTER_RE)].map((m) => ({
    table: m[1],
    column: m[2],
    type: m[3],
    tail: m[4].trim(),
  }));
}

function firstStatement(sql: string): string {
  const code = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .trim();
  return code.slice(0, code.indexOf(";") + 1);
}

function usingProblems(alters: AlterStatement[]): string[] {
  return alters.flatMap((a) => {
    const m = /^USING "([^"]+)" AT TIME ZONE 'UTC'$/.exec(a.tail);
    if (!m) return [`"${a.table}"."${a.column}": missing USING "${a.column}" AT TIME ZONE 'UTC'`];
    if (m[1] !== a.column) return [`"${a.table}"."${a.column}": USING names wrong column "${m[1]}"`];
    return [];
  });
}

const files = readdirSync(DRIZZLE_DIR).filter((f) => SLICE_RE.test(f));
const forward = files.filter((f) => !f.endsWith("_rollback.sql"));
const rollback = files.filter((f) => f.endsWith("_rollback.sql"));

test("finds forward and rollback migration files for every slice", () => {
  assert.ok(forward.length >= 5, `expected >=5 forward slice files, found ${forward.length}`);
  assert.equal(rollback.length, forward.length);
});

for (const f of forward) {
  const sql = readFileSync(join(DRIZZLE_DIR, f), "utf8");
  const alters = parseAlters(sql);

  test(`${f}: first statement is SET LOCAL lock_timeout = '2s'`, () => {
    assert.equal(firstStatement(sql), "SET LOCAL lock_timeout = '2s';");
  });

  test(`${f}: every ALTER to timestamptz has a USING clause on the same column`, () => {
    assert.ok(alters.length > 0, "no ALTER ... SET DATA TYPE found");
    assert.ok(alters.every((a) => a.type === "timestamp with time zone"));
    assert.deepEqual(usingProblems(alters), []);
  });
}

for (const f of rollback) {
  const sql = readFileSync(join(DRIZZLE_DIR, f), "utf8");
  const alters = parseAlters(sql);

  test(`${f}: every ALTER back to naive timestamp has a USING clause on the same column`, () => {
    assert.ok(alters.length > 0, "no ALTER ... SET DATA TYPE found");
    assert.ok(alters.every((a) => a.type === "timestamp"));
    assert.deepEqual(usingProblems(alters), []);
  });
}

test("checker self-test: flags a missing USING, a wrong column, and a missing lock_timeout", () => {
  const bad = `-- c\nALTER TABLE "t" ALTER COLUMN "a" SET DATA TYPE timestamp with time zone;
ALTER TABLE "t" ALTER COLUMN "b" SET DATA TYPE timestamp with time zone USING "a" AT TIME ZONE 'UTC';`;
  const problems = usingProblems(parseAlters(bad));
  assert.equal(problems.length, 2);
  assert.match(problems[0], /missing USING/);
  assert.match(problems[1], /wrong column "a"/);
  assert.notEqual(firstStatement(bad), "SET LOCAL lock_timeout = '2s';");
});
