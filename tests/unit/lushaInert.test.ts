import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Mechanical form of the safety rule of the lusha-reveal chain: nothing a user
// can reach exists until the UI PR (6). Lusha spends real money, so every
// assertion here is inverted in task 6.9, the PR that deliberately wires it up.

const ROOT = join(__dirname, "..", "..");
const APP = join(ROOT, "src", "app");
const SRC = join(ROOT, "src");
const ACTIONS_FILE = "src/app/(app)/contacts/lushaActions.ts";
// The ONLY file outside the library allowed to import it. It must not grow quietly.
const ALLOWLIST = [ACTIONS_FILE];
const LIBRARY_DIR = "src/lib/lusha/";

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
const EXTRA = ["middleware.ts", "instrumentation.ts"].map((n) => join(ROOT, "src", n)).filter(existsSync);
const sourceFiles = [...walk(APP), ...EXTRA].filter((f) => /\.(ts|tsx)$/.test(f));
// Everything under src/ (components, lib, db...) except the library itself: a client component outside src/app
// importing the actions would make the feature reachable with a src/app-only scan still green.
const allSrc = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !rel(f).startsWith(LIBRARY_DIR));
// Any quoted path into the lusha library: static, dynamic import(), require() or bare import.
const LUSHA_LIB_PATH = /["'`][^"'`]*\/lib\/lusha(\/[^"'`]*)?["'`]/;

test("the scan covers a non-trivial set of source files", () => {
  assert.ok(sourceFiles.length > 0);
});

test("the allowlist is exactly one file", () => {
  assert.equal(ALLOWLIST.length, 1);
  assert.ok(existsSync(join(ROOT, ALLOWLIST[0])));
  assert.ok(allSrc.length > sourceFiles.length / 2, "the src-wide scan covers more than src/app");
});

test("no file under src outside the library, other than the allowlisted one, imports from the lusha library", () => {
  const offenders = allSrc
    .filter((f) => !ALLOWLIST.includes(rel(f)))
    .filter((f) => LUSHA_LIB_PATH.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test("no file under src imports lushaActions", () => {
  const offenders = allSrc
    .filter((f) => /lushaActions/.test(readFileSync(f, "utf8")))
    .filter((f) => !ALLOWLIST.includes(rel(f)))
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
  const offenders = allSrc
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

test("the lusha path matcher catches every import form", () => {
  const forms = [
    'import { x } from "@/lib/lusha/cap";',
    'const m = await import("@/lib/lusha/cap");',
    'const m = require("../../lib/lusha/cap");',
    'import "@/lib/lusha/cap";',
    "import { y } from '@/lib/lusha';",
  ];
  for (const f of forms) assert.ok(LUSHA_LIB_PATH.test(f), f);
  assert.ok(!LUSHA_LIB_PATH.test('import { z } from "@/lib/lushaless/x";'));
});
