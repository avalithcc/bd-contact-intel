/**
 * Enforces the due_at-only half of the contract documented on
 * src/lib/tasks/argentinaDate.ts: `argentinaDayBoundaries` (and its
 * `ArgentinaDayBoundaries.todayStartUtc`/`tomorrowStartUtc` naive 00:00-UTC
 * fields) exist ONLY to bound `task.due_at` — a bare calendar-date column,
 * never a real instant. Bounding a real timestamp column
 * (`activity.created_at`, the effective activity time, ...) with it
 * reintroduces the exact 2026-09-30 "worked today" day-boundary bug: an
 * activity logged ~21:00-24:00 ART failed the window entirely, because
 * ART midnight tomorrow (03:00 UTC) is hours after `tomorrowStartUtc`
 * (00:00 UTC).
 *
 * This test statically scans every `.ts`/`.tsx` file under `src` for an
 * import of `argentinaDayBoundaries` from `@/lib/tasks/argentinaDate` and
 * fails the build if a file NOT on `ALLOWED_DUE_AT_FILES` imports it — a new
 * caller must be explicitly reviewed and classified (due_at vs. instant)
 * before it's added to the allowlist, instead of silently compiling.
 *
 * Genuinely enforceable (not decorative): the fixture test below proves a
 * new, unlisted importer is actually caught, the same "fixture proof"
 * pattern as tests/unit/rethrowNavigationErrors.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, sep } from "node:path";

const SRC = "src";

/**
 * Every file allowed to import `argentinaDayBoundaries`, because it only
 * ever uses `today`/`yesterday`/`todayStartUtc`/`tomorrowStartUtc` to bound
 * or format `task.due_at` — reviewed as part of the 2026-09-30
 * launch-readiness audit. Adding a new entry here is a deliberate
 * classification decision, not a rubber stamp.
 */
const ALLOWED_DUE_AT_FILES = new Set([
  join(SRC, "lib", "tasks", "argentinaDate.ts"), // defines it
  join(SRC, "lib", "tasks", "queries.ts"), // getOverdueTasks/getAllOverdueTasks — task.due_at only
  join(SRC, "lib", "shell", "appShellBadgeCounts.ts"), // task_count subquery's due_at bound only
  join(SRC, "app", "api", "tasks", "digest", "route.ts"), // digest task selection — task.due_at only
]);

const IMPORT_RE = /import\s*\{[^}]*\bargentinaDayBoundaries\b[^}]*\}\s*from\s*["']@\/lib\/tasks\/argentinaDate["']/;

function scan(): string[] {
  const allFiles = (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => join(SRC, f));

  const offenders: string[] = [];
  for (const file of allFiles) {
    const content = readFileSync(file, "utf8");
    if (IMPORT_RE.test(content) && !ALLOWED_DUE_AT_FILES.has(file)) {
      offenders.push(file);
    }
  }
  return offenders;
}

test("argentinaDayBoundaries is imported only by files that bound task.due_at, not a real instant column", () => {
  const offenders = scan();
  if (offenders.length > 0) {
    assert.fail(
      `${offenders.length} file(s) import argentinaDayBoundaries without being on ALLOWED_DUE_AT_FILES: ` +
        `${offenders.join(", ")}. If this file bounds task.due_at, add it to the allowlist with a comment saying ` +
        `so; if it bounds a real timestamp column, use argentinaInstantDayWindow/argentinaInstantBoundary instead ` +
        `(see src/lib/tasks/argentinaDate.ts's module doc comment).`,
    );
  }
});

test("fixture proof: a new, unlisted importer of argentinaDayBoundaries is actually caught", () => {
  const fixtureDir = join(SRC, "__argentina_day_boundaries_fixture_tmp__");
  const fixturePath = join(fixtureDir, "offender.ts");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    fixturePath,
    [
      'import { argentinaDayBoundaries } from "@/lib/tasks/argentinaDate";',
      "",
      "export function bogusInstantBound(now: Date) {",
      "  return argentinaDayBoundaries(now).tomorrowStartUtc;",
      "}",
      "",
    ].join("\n"),
  );

  try {
    const offenders = scan();
    assert.ok(
      offenders.includes(fixturePath),
      "the fixture's unlisted argentinaDayBoundaries import must be reported as an offender",
    );
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
