import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Every launch-readiness spec file runs in ONE Playwright worker (workers: 1),
// so they share one module instance of helpers.ts and its `sql` pool. The pool
// is closed once, by the worker-scoped fixture in helpers.ts. A spec that ends
// it itself breaks every spec that runs after it (CONNECTION_ENDED); a spec
// that takes `test` from @playwright/test bypasses the fixture and leaves the
// pool open when the worker finishes. These checks keep both from coming back.
const dir = path.join(__dirname, "..", "launch-readiness");
const specs = fs.readdirSync(dir).filter((n) => /\.spec\.ts$/.test(n));

test("there are launch-readiness specs to check", () => {
  assert.ok(specs.length >= 9);
});

for (const file of specs) {
  const source = fs.readFileSync(path.join(dir, file), "utf8");

  test(`${file} does not end the shared pool itself`, () => {
    assert.doesNotMatch(source, /\bsql\.end\(/);
  });

  test(`${file} takes test from ./helpers, not from @playwright/test`, () => {
    const playwrightImports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@playwright\/test'/g)];
    for (const m of playwrightImports) {
      const names = m[1]!.split(",").map((n) => n.trim());
      assert.ok(!names.includes("test"), "imports `test` from @playwright/test");
    }
    assert.match(source, /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*'\.\/helpers'/);
  });
}
