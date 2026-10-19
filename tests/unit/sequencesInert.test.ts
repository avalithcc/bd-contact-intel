import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isSessionExemptPath } from "@/lib/auth/sessionExemptRoutes";
import { NAVIGATION } from "@/app/contacts/Sidebar";
import { t } from "@/lib/i18n/dictionaries";

// Go-live (task 13.7). Until PR 13 this file asserted the opposite of everything below: it was the mechanical form of
// the two hard safety rules of the outreach-sequences chain (nothing sends, nothing is reachable). PR 13 deliberately
// wires it up, so the same facts are now pinned as positive assertions: the cron exists exactly where it should, the
// pages and routes exist, both routes bypass the session gate, and the runner is reachable from exactly ONE file.

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

const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

test("vercel.json registers the sequence runner exactly twice, at 13:00 and 14:00 UTC", () => {
  const config = JSON.parse(read("vercel.json")) as { crons?: { path: string; schedule: string }[] };
  const sequenceCrons = (config.crons ?? []).filter((c) => /sequences/i.test(c.path));
  assert.deepEqual(sequenceCrons, [
    { path: "/api/sequences/run", schedule: "0 13 * * *" },
    { path: "/api/sequences/run", schedule: "0 14 * * *" },
  ]);
});

test("the sequence pages and both routes exist", () => {
  for (const file of ["sequences/page.tsx", "sequences/new/page.tsx", "sequences/[id]/page.tsx"]) {
    assert.ok(existsSync(join(APP, "(app)", file)), file);
  }
  for (const file of ["api/sequences/run/route.ts", "api/unsubscribe/route.ts"]) assert.ok(existsSync(join(APP, file)), file);
});

test("both routes bypass the session gate, and their siblings do not", () => {
  assert.equal(isSessionExemptPath("/api/sequences/run"), true);
  assert.equal(isSessionExemptPath("/api/unsubscribe"), true);
  assert.equal(isSessionExemptPath("/api/unsubscribe-admin"), false);
  assert.equal(isSessionExemptPath("/sequences"), false);
});

test("the runner route is GET-only, dynamic, 300s, and carries no session code", () => {
  const route = read("src", "app", "api", "sequences", "run", "route.ts");
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /export const maxDuration = 300/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export (async function|const) (POST|PUT|PATCH|DELETE)/);
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.doesNotMatch(route, /getCurrentBd|from ["'][^"']*supabase/i);
});

test("the unsubscribe route serves GET and POST through the Drizzle client, never supabase-js", () => {
  const route = read("src", "app", "api", "unsubscribe", "route.ts");
  assert.match(route, /export const GET\b/);
  assert.match(route, /export const POST\b/);
  assert.doesNotMatch(route, /from ["'][^"']*supabase/i);
  assert.match(route, /unsubscribeQueries/);
});

test("the sidebar has a Secuencias entry below Seguimientos (Reuniones sits between them, per the meeting-outcomes mockup)", () => {
  const items = NAVIGATION.flatMap((section) => section.items);
  const at = items.findIndex((item) => item.labelKey === "followUps");
  assert.ok(at >= 0);
  assert.equal(items[at + 1]?.labelKey, "meetings");
  assert.equal(items[at + 1]?.href, "/reuniones");
  assert.equal(items[at + 2]?.labelKey, "sequences");
  assert.equal(items[at + 2]?.href, "/sequences");
  assert.equal(t("es").nav.sequences, "Secuencias");
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

test("exactly one file under src/app imports the sequence runner: the cron route", () => {
  const importers = walk(APP)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => RUNNER_IMPORT.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(importers, ["src/app/api/sequences/run/route.ts"]);
});

test("no other file in src imports the runner or its ports (no indirect path to a send)", () => {
  const allowed = new Set([
    "src/lib/sequences/runSequenceRelease.ts",
    "src/lib/sequences/releaseQueries.ts",
    "src/app/api/sequences/run/route.ts",
    // Names the RunSummary TYPE only (asserted below): erased at compile time, so it is no path to a send.
    "src/lib/sequences/runHandler.ts",
  ]);
  const offenders = walk(join(ROOT, "src"))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !allowed.has(rel(f)))
    .filter((f) => RUNNER_IMPORT.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test("the one other allowed importer, the run handler, imports the runner as a type only", () => {
  const handler = read("src", "lib", "sequences", "runHandler.ts");
  const imports = [...handler.matchAll(/^import .*["']\.\/(?:runSequenceRelease|releaseQueries)["'];?$/gm)].map((m) => m[0]);
  assert.ok(imports.length > 0);
  for (const line of imports) assert.match(line, /^import type /, line);
});
