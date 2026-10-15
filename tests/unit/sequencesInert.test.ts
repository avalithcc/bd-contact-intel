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

// The runner and its real ports. The original `run\b` matched only a module literally named `run`, so the actual
// runner (`runSequenceRelease`, task 9.5) and its DB ports (`releaseQueries`) slipped past it; the task 1.1 wording is
// "@/lib/sequences/run*".
// It matches the module SPECIFIER in either form: the alias, or any relative path ("./runSequenceRelease",
// "../sequences/releaseQueries", "../../lib/sequences/run"). A relative import is the same module.
// Two branches, because there are two ways into the runner from src/app:
//   * a bare `.../sequences` barrel — nothing imports one today, and one re-exporting the runner is exactly the hole
//     this guard exists to close;
//   * the runner module itself, by alias or by relative path at any depth, INCLUDING a bare sibling (`./run...`),
//     which would mean a copy of the runner living under src/app.
// Backticks count: a template-literal `import()` is still an import. So does an explicit file extension.
// `run\w*` deliberately over-matches a relative module merely starting with "run" (`./runtime`). Nothing in src trips
// it, and for a safety rail a false positive costs a conversation while a false negative ships the cron.
// The leading `@/` or `./` is required: it is what makes this a MODULE specifier and not a route. Without it the
// barrel branch also matched the href "/sequences" in a Cancel link.
const RUNNER_IMPORT =
  /["'`](?:@\/(?:[\w.-]+\/)*|\.{1,2}\/(?:[\w.-]+\/)*)(?:sequences|(?:run\w*|releaseQueries)(?:\.[jt]sx?)?)["'`]/;

test("the runner import guard matches the real runner modules, and not the pure planning ones", () => {
  const specifiers = (name: string) => [`@/lib/sequences/${name}`, `./${name}`, `../${name}`, `../../lib/sequences/${name}`];
  for (const name of ["run", "runSequenceRelease", "releaseQueries"]) {
    for (const spec of specifiers(name)) {
      for (const quote of ['"', "'", "`"]) assert.match(`import { x } from ${quote}${spec}${quote};`, RUNNER_IMPORT, spec);
      assert.match(`await import("${spec}")`, RUNNER_IMPORT, spec);
      assert.match(`await import(\`${spec}\`)`, RUNNER_IMPORT, `template literal: ${spec}`);
      assert.match(`import { x } from "${spec}.js";`, RUNNER_IMPORT, `with extension: ${spec}`);
    }
  }
  // A barrel that re-exports the runner is the same reachability, so the barrel itself is refused.
  for (const spec of ["@/lib/sequences", "../sequences", "../../lib/sequences"]) {
    assert.match(`import { runSequenceRelease } from "${spec}";`, RUNNER_IMPORT, spec);
  }
  for (const name of ["releasePlan", "preSendChecks", "memberState", "releaseSelection"]) {
    for (const spec of specifiers(name)) assert.doesNotMatch(`import { x } from "${spec}";`, RUNNER_IMPORT, spec);
  }
});

test("no file under src/app imports the sequence runner", () => {
  const offenders = appFiles
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => RUNNER_IMPORT.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test("no file in src outside the runner itself imports the runner or its ports (no indirect path to a send)", () => {
  const allowed = new Set(["src/lib/sequences/runSequenceRelease.ts", "src/lib/sequences/releaseQueries.ts"]);
  const offenders = walk(join(ROOT, "src"))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !allowed.has(rel(f)))
    .filter((f) => RUNNER_IMPORT.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, []);
});
