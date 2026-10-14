import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Mechanical form of the safety rule of the lusha-reveal chain: nothing a user
// can reach exists until the UI PR (6). Lusha spends real money, so every
// assertion here is inverted in task 6.9, the PR that deliberately wires it up.

const ROOT = join(__dirname, "..", "..");
const APP = join(ROOT, "src", "app");
const ACTIONS_FILE = "src/app/(app)/contacts/lushaActions.ts";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p);
const sourceFiles = walk(APP).filter((f) => /\.(ts|tsx)$/.test(f));

test("no file under src/app other than lushaActions.ts imports from the lusha library", () => {
  const offenders = sourceFiles
    .filter((f) => rel(f) !== ACTIONS_FILE)
    .filter((f) => /from\s+["'][^"']*\/lib\/lusha(\/|["'])/.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test("no file under src/app imports lushaActions", () => {
  const offenders = sourceFiles
    .filter((f) => /lushaActions/.test(readFileSync(f, "utf8")))
    .filter((f) => rel(f) !== ACTIONS_FILE)
    .map(rel);
  assert.deepEqual(offenders, []);
});

test("no route.ts or page.tsx path contains lusha", () => {
  const offenders = walk(APP)
    .map(rel)
    .filter((f) => /(^|\/)(page\.tsx|route\.ts)$/.test(f) && /lusha/i.test(f));
  assert.deepEqual(offenders, []);
});

test('no "use client" file references lushaActions', () => {
  const offenders = sourceFiles
    .filter((f) => {
      const text = readFileSync(f, "utf8");
      return /^\s*["']use client["']/m.test(text) && /lushaActions/.test(text);
    })
    .map(rel);
  assert.deepEqual(offenders, []);
});

test("vercel.json contains no lusha entry", () => {
  const raw = readFileSync(join(ROOT, "vercel.json"), "utf8");
  assert.doesNotMatch(raw, /lusha/i);
});
