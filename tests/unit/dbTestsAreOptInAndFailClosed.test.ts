/**
 * tests/db/ runs real queries and must never run against production. Pins the
 * two things that keep it safe: it is outside the unit glob, and every file in
 * it calls the scratch-database guard before anything can import the real db
 * client (a static import of "@/db" would connect at load time).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

test("test:unit does not pick up tests/db and test:db is its own script", () => {
  assert.doesNotMatch(pkg.scripts["test:unit"]!, /tests\/db/);
  assert.match(pkg.scripts["test:db"]!, /tests\/db\//);
});

test("every tests/db file guards the database URL before it can touch the db", () => {
  const files = readdirSync("tests/db").filter((f) => f.endsWith(".test.ts"));
  assert.ok(files.length > 0);
  for (const f of files) {
    const src = readFileSync(`tests/db/${f}`, "utf8");
    const guard = src.indexOf("assertScratchDatabaseUrl(process.env.DATABASE_URL)");
    assert.ok(guard >= 0, `${f} must call assertScratchDatabaseUrl`);
    assert.doesNotMatch(src, /^import .* from "@\/db(\/|")/m, `${f} must not statically import the db client`);
    assert.doesNotMatch(src, /^import .* from "@\/lib\//m, `${f} must not statically import app code that loads the db`);
    const firstDynamic = src.indexOf('await import("@/');
    assert.ok(firstDynamic > guard, `${f}: the guard must come before the first dynamic import`);
  }
});
