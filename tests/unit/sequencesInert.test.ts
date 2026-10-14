import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Mechanical form of the two hard safety rules of the outreach-sequences chain:
// nothing may send and nothing may be reachable until the final PR (13). Every
// assertion here is inverted in task 13.7, the PR that deliberately wires it up.

const ROOT = join(__dirname, "..", "..");
const APP = join(ROOT, "src", "app");

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
const appFiles = walk(APP);

test("vercel.json registers no cron whose path mentions sequences", () => {
  const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
    crons?: { path: string }[];
  };
  const offenders = (config.crons ?? []).filter((c) => /sequences/i.test(c.path));
  assert.deepEqual(offenders, []);
});

test("no page.tsx or route.ts exists under a sequences directory in src/app", () => {
  const offenders = appFiles
    .map(rel)
    .filter((f) => /(^|\/)sequences\//.test(f) && /(^|\/)(page\.tsx|route\.ts)$/.test(f));
  assert.deepEqual(offenders, []);
});

test("no page.tsx or route.ts exists under src/app/api/unsubscribe", () => {
  const dir = join(APP, "api", "unsubscribe");
  const offenders = walk(dir)
    .map(rel)
    .filter((f) => /(^|\/)(page\.tsx|route\.ts)$/.test(f));
  assert.deepEqual(offenders, []);
});

test("the sidebar nav source has no Secuencias entry", () => {
  const navFiles = appFiles.filter((f) => /(^|\/)Sidebar\.tsx$/.test(f));
  assert.ok(navFiles.length > 0, "expected to find the sidebar nav source");
  const offenders = navFiles.filter((f) => /Secuencias/.test(readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(offenders, []);
});

test("no file under src/app imports the sequence runner", () => {
  const offenders = appFiles
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => /@\/lib\/sequences\/run\b/.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, []);
});
