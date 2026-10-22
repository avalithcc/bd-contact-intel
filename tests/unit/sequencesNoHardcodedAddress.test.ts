import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Spec "No hardcoded address": the sender identity lives in configuration, never as a literal in sequence code.
const ROOT = join(__dirname, "..", "..");
const SEQUENCES = join(ROOT, "src", "lib", "sequences");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

test("no @avalith.net literal exists under src/lib/sequences outside tests and fixtures", () => {
  const offenders = walk(SEQUENCES)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/(^|\/)fixtures?\//.test(f))
    .filter((f) => /@avalith\.net/i.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, []);
});

test("the postal address strings are defined in config.ts and nowhere else under src/lib/sequences", () => {
  const offenders = walk(SEQUENCES)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/(^|\/)config\.ts$/.test(f))
    .filter((f) => /Ansin|Formosa 2531/.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, []);
});

test("the opt-out sentences (every language) are defined in config.ts and nowhere else under src/lib/sequences", () => {
  // Fragments of each sentence, derived from the real config so a reworded sentence is still guarded, plus a literal
  // from each language so the guard cannot go vacuous if config.ts is ever emptied.
  const { OPT_OUT_TEXT } = require("../../src/lib/sequences/config") as typeof import("../../src/lib/sequences/config");
  const fragments = [...Object.values(OPT_OUT_TEXT).map((t) => t.slice(0, 24)), "would rather not receive", "Si prefieres no recibir"];
  assert.ok(fragments.every((f) => f.length >= 20), "fragments are long enough to be unique");
  const offenders = walk(SEQUENCES)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/(^|\/)config\.ts$/.test(f))
    .filter((f) => { const src = readFileSync(f, "utf8"); return fragments.some((frag) => src.includes(frag)); })
    .map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, []);
  assert.ok(/Si prefieres no recibir/.test(readFileSync(join(SEQUENCES, "config.ts"), "utf8")), "and config.ts does hold it");
});
