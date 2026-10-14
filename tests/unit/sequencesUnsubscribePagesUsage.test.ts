import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(__dirname, "..", "..");
const source = readFileSync(join(ROOT, "src", "components", "sequences", "UnsubscribePages.tsx"), "utf8");
const css = ["design-system.css", "globals.css"]
  .map((f) => readFileSync(join(ROOT, "src", "app", f), "utf8"))
  .join("
");

test("the unsubscribe pages use only classes that exist in the design system", () => {
  const used = new Set<string>();
  for (const m of source.matchAll(/className="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) used.add(c);
  assert.ok(used.size > 0);
  const missing = [...used].filter((c) => !new RegExp(`\\.${c}\\b`).test(css));
  assert.deepEqual(missing, []);
});

test("the confirmation form POSTs to the unsubscribe route and carries the token", () => {
  assert.match(source, /method="post"/);
  assert.match(source, /action="\/api\/unsubscribe"/);
  assert.match(source, /name="t"/);
});

test("the invalid page never renders an address", () => {
  const start = source.indexOf("export function UnsubscribeInvalid");
  const invalid = source.slice(start, source.indexOf("export function", start + 1));
  assert.doesNotMatch(invalid, /email/i);
});
