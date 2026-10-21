import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

const SRC = path.resolve(__dirname, "../../src");
const HOME = path.join("lib", "sequences", "rosterQuery.ts");
const compile = (q: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(q);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full;
  }
}

// Pinned as literals on purpose: if the helper changes meaning, this fails; it is never derived from the helper.
test("sameCompanyAs compiles to the exact same-company clause for each alias", async () => {
  const { sameCompanyAs } = await import("@/lib/sequences/rosterQuery");
  assert.equal(
    compile(sameCompanyAs("jp")).sql,
    "(jp.company_key = p.company_key or jp.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))",
  );
  assert.equal(
    compile(sameCompanyAs("c")).sql,
    "(c.company_key = p.company_key or c.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))",
  );
  assert.deepEqual(compile(sameCompanyAs("jp")).params, []);
});

test("the alias-aware same-company clause is spelled in one place only", () => {
  // Honest limit: this matches the `ca.alias_key = p.company_key` spelling only. A copy that renames the person alias or
  // rewrites the clause as a join slips past it. It is deliberately not widened to `company_alias`, which legitimate
  // unrelated reads also use.
  const needle = /company_alias\s+ca\s+where\s+ca\.alias_key\s*=\s*p\.company_key/;
  const files = [...sourceFiles(SRC)];
  // Guard against a vacuous pass: if SRC resolves wrong the walk finds nothing and the test below would be green for free.
  assert.ok(files.length > 100, `expected the walk to find well over 100 source files under ${SRC}, found ${files.length}`);
  const offenders = files
    .filter((file) => !file.endsWith(HOME))
    .filter((file) => needle.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file));
  assert.deepEqual(
    offenders,
    [],
    `The same-company-through-alias clause is written inline in: ${offenders.join(", ")}. Do not copy it: import { sameCompanyAs } from "@/lib/sequences/rosterQuery" and use sameCompanyAs("jp") or sameCompanyAs("c"). Copies drifted apart before (#372-#374).`,
  );
});
