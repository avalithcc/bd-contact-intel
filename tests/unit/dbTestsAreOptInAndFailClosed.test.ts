/**
 * tests/db/ runs real queries and must never run against production. This is a
 * tripwire for the conventions that keep it safe (the guard itself is
 * `assertScratchDatabaseUrl`; this only checks nobody can load the real db
 * client before it runs):
 *  - tests/db is outside the unit glob and has its own script;
 *  - EVERY file under tests/db, recursively and whatever its name (a helper not
 *    called *.test.ts is still imported by tests, and the `test:db` glob
 *    recurses), calls the guard at top level before anything else can load;
 *  - its static imports are an ALLOWLIST: `node:*`, the guard, and type-only
 *    imports (erased at runtime). Anything else, including a helper that could
 *    itself import "@/db" and connect at module load, is rejected;
 *  - every dynamic `import(` / `require(` comes after the guard call.
 * Comments and string contents are blanked before matching, so a guard call or
 * an import that only appears in a comment or a string does not count.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const GUARD_SPECIFIER = /^(\.\.\/)+launch-readiness\/scratchDbGuard$/;
const GUARD_CALL = /^assertScratchDatabaseUrl\(process\.env\.DATABASE_URL\);/m;

/** Blanks comments entirely and the CONTENT of string/template literals (quotes kept), preserving offsets. */
export function blank(src: string, keepStrings: boolean): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") (out += " "), i++;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      const body = src.slice(i + 1, j);
      out += c + (keepStrings ? body : body.replace(/[^\n]/g, " ")) + (j < src.length ? c : "");
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function checkTestsDbFile(name: string, src: string): string[] {
  const problems: string[] = [];
  const withStrings = blank(src, true);
  const bare = blank(src, false);

  // Matched on `bare` (string bodies blanked) so an import-looking string never matches;
  // the specifier is then read from `withStrings` at the same offsets.
  const staticImport = /\b(import|export)\b(?!\s*\()(?:[^'"`;()]*?\bfrom\b)?\s*(["'])/g;
  for (const m of bare.matchAll(staticImport)) {
    const open = m.index! + m[0].length;
    const spec = withStrings.slice(open, withStrings.indexOf(m[2]!, open));
    const typeOnly = /^(import|export)\s+type\b/.test(m[0]);
    if (typeOnly || spec.startsWith("node:") || GUARD_SPECIFIER.test(spec)) continue;
    problems.push(`${name}: static import of "${spec}" is not allowed (only node:*, the guard, and import type)`);
  }

  const guard = bare.search(GUARD_CALL);
  if (guard < 0) problems.push(`${name}: must call assertScratchDatabaseUrl(process.env.DATABASE_URL); at top level`);

  for (const m of bare.matchAll(/(?<!typeof\s)(?<![.\w])(?:import|require)\s*\(/g)) {
    if (guard < 0 || m.index! < guard) problems.push(`${name}: dynamic import/require at offset ${m.index} comes before the guard`);
  }
  return problems;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

test("test:unit does not pick up tests/db and test:db is its own script", () => {
  assert.doesNotMatch(pkg.scripts["test:unit"]!, /tests\/db/);
  assert.match(pkg.scripts["test:db"]!, /tests\/db\//);
});

test("every file under tests/db, whatever its name, is guarded and imports only what is allowed", () => {
  const files = listFiles("tests/db");
  assert.ok(files.some((f) => f.endsWith(".test.ts")));
  const problems = files.flatMap((f) => checkTestsDbFile(f, readFileSync(f, "utf8")));
  assert.deepEqual(problems, []);
});

// --- the checker itself must have teeth ---------------------------------------

const GUARDED = `import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";\nassertScratchDatabaseUrl(process.env.DATABASE_URL);\n`;

test("checker accepts a guarded file that loads the db dynamically afterwards", () => {
  const src = `import assert from "node:assert/strict";\nimport type { db } from "@/db";\n${GUARDED}const m = await import("@/db");\ntype T = typeof import("@/db").db;\n`;
  assert.deepEqual(checkTestsDbFile("ok.ts", src), []);
});

const BAD: Array<[string, string]> = [
  ["plain static import of @/db", `import { db } from "@/db";\n${GUARDED}`],
  ["multi-line static import", `import {\n  db,\n  x,\n} from "@/db";\n${GUARDED}`],
  ["side-effect import", `import "@/db";\n${GUARDED}`],
  ["relative path to src/db", `import { db } from "../../src/db";\n${GUARDED}`],
  ["a helper import (could load the db itself)", `import { helper } from "./helper";\n${GUARDED}`],
  ["re-export from a module", `export { db } from "@/db";\n${GUARDED}`],
  ["require before the guard", `const d = require("@/db");\n${GUARDED}`],
  ["dynamic import before the guard", `const d = await import("../helper");\n${GUARDED}`],
  ["no guard call at all", `import assert from "node:assert/strict";\n`],
  ["guard only in a comment", `// assertScratchDatabaseUrl(process.env.DATABASE_URL);\nconst m = await import("@/db");\n`],
  ["guard only in a block comment", `/*\nassertScratchDatabaseUrl(process.env.DATABASE_URL);\n*/\n`],
  ["guard only in a string", `const s = "\\nassertScratchDatabaseUrl(process.env.DATABASE_URL);";\n`],
  ["guard indented inside a function", `function f() {\n  assertScratchDatabaseUrl(process.env.DATABASE_URL);\n}\n`],
];
for (const [label, src] of BAD) {
  test(`checker rejects: ${label}`, () => {
    assert.notDeepEqual(checkTestsDbFile("bad.ts", src), []);
  });
}

test("checker ignores an import that appears only in a comment or a string", () => {
  const src = `${GUARDED}// import { db } from "@/db";\nconst s = 'import { db } from "@/db"';\n`;
  assert.deepEqual(checkTestsDbFile("ok.ts", src), []);
});
