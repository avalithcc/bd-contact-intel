/**
 * The stranded-reservation window: what counts as "cannot be in flight any more", read side and the premise it rests on.
 * Pure: no DB. The reap itself is tested in tests/db/lushaReveal.test.ts.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FUNCTION_MAX_DURATION_MS, STRANDED_AFTER_MS, isOutcomeUnknown } from "@/lib/lusha/revealState";

const NOW = new Date("2026-10-15T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

test("a failed row with an unknown-outcome code is unknown; so is a reserved row older than the stranded window", () => {
  assert.equal(isOutcomeUnknown({ state: "failed", errorCode: "outcome_unknown", at: ago(0) }, NOW), true);
  assert.equal(isOutcomeUnknown({ state: "failed", errorCode: "reaped", at: ago(0) }, NOW), true);
  assert.equal(isOutcomeUnknown({ state: "reserved", errorCode: null, at: ago(STRANDED_AFTER_MS + 1) }, NOW), true, "no other reserve() has swept it yet, but it cannot be in flight");
});

test("a reserved row inside the window may be in flight and is NOT unknown; other failures are plain failures", () => {
  assert.equal(isOutcomeUnknown({ state: "reserved", errorCode: null, at: ago(STRANDED_AFTER_MS - 1000) }, NOW), false);
  assert.equal(isOutcomeUnknown({ state: "failed", errorCode: "rate_limited", at: ago(0) }, NOW), false);
  assert.equal(isOutcomeUnknown({ state: "settled", errorCode: null, at: ago(STRANDED_AFTER_MS * 10) }, NOW), false);
  assert.equal(isOutcomeUnknown(null, NOW), false);
  assert.equal(isOutcomeUnknown({ state: "reserved", errorCode: null, at: ago(STRANDED_AFTER_MS + 1).toISOString() }, NOW), true, "a timestamp that arrived as a string");
});

// --- the premise: no route that can run a Lusha action may outlive the 60 s the window is derived from ----------------

const ROOT = join(__dirname, "..", "..");
const walk = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])) : []);
const files = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f));
const resolve = (from: string, spec: string): string | null => {
  const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? join(from, "..", spec) : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((c) => files.includes(c)) ?? null;
};

/** Every page, route and layout that transitively imports lushaActions (type-only imports included: over-approximating is the safe side). */
function hosts(entry: string): string[] {
  const importers = new Map<string, Set<string>>();
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(/^(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)) {
      const target = resolve(f, m[1]);
      if (target) importers.set(target, (importers.get(target) ?? new Set()).add(f));
    }
  }
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) for (const up of importers.get(queue.shift()!) ?? []) if (!seen.has(up)) seen.add(up) && queue.push(up);
  return [...seen].filter((f) => /\/(page\.tsx|route\.ts|layout\.tsx)$/.test(f));
}

test("every route that can reach lushaActions declares a maxDuration, and the stranded window outlasts the largest", () => {
  const hosting = hosts(join(ROOT, "src/app/(app)/contacts/lushaActions.ts"));
  assert.ok(hosting.some((f) => f.endsWith("contacts/[id]/page.tsx")), "the scan found the page that mounts the control");
  const durations = hosting.map((f) => ({ f, s: Number(/export const maxDuration = (\d+)/.exec(readFileSync(f, "utf8"))?.[1]) }));
  for (const d of durations) assert.ok(d.s > 0, `${d.f} reaches lushaActions without declaring maxDuration`);
  const largest = Math.max(...durations.map((d) => d.s)) * 1000;
  assert.ok(FUNCTION_MAX_DURATION_MS >= largest, `the 60 s premise (${FUNCTION_MAX_DURATION_MS} ms) is below a hosting route's ${largest} ms`);
  assert.ok(STRANDED_AFTER_MS > largest);
});
