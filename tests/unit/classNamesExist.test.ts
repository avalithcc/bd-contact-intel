/**
 * Every static CSS class the app renders must be defined in one of the app's stylesheets.
 *
 * This is the first check of the `ux-auditor` profile, made permanent. Two instances reached production and were only
 * found by reading: `mt-sm` in the absorption dialog, where the scale had `mt-2xs` and `mt-md` but no `sm`, so the
 * element silently got no margin; and `.soft`, which a check of `design-system.css` alone "proved" missing while it
 * sat in `globals.css` — the second mistake this guard also prevents, because it reads BOTH files.
 *
 * Scope, deliberately narrow so a failure always means something:
 *  - only `className="…"` with a literal string. Template literals and variables are skipped; their values are not
 *    knowable here, and guessing produced false findings in the manual audit.
 *  - CSS-module classes (`styles.x`) are not here: those are compile-checked by TypeScript already.
 *
 * It does NOT check reachability — a class can exist and still do nothing outside its required ancestor
 * (`.nav-item .pill-count` on a `summary.btn` rendered unstyled for weeks). That is check 1's other half and still
 * needs eyes.
 */
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const STYLESHEETS = ["src/app/design-system.css", "src/app/globals.css"];

/** Tailwind-style utilities and third-party hooks that are not ours to define. */
const NOT_OURS = new Set(["sr-only", "group", "peer"]);

/**
 * Classes that style nothing and are not meant to: identification markers on an element that already carries its real
 * classes. Both were found by this guard on its first run; neither is referenced by any stylesheet, test or script, so
 * both are candidates for deletion — listed rather than removed, because they are not mine to decide and a silent
 * delete is worse than a named exception. Do not grow this list to make a failure go away: a class that should paint
 * something belongs in a stylesheet.
 */
const MARKERS_NOT_STYLES = new Set(["duplicates-unmerge-confirm", "tz-name"]);

function definedClasses(): Set<string> {
  const out = new Set<string>();
  for (const file of STYLESHEETS) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]!);
  }
  return out;
}

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) tsxFiles(path, acc);
    else if (entry.name.endsWith(".tsx")) acc.push(path);
  }
  return acc;
}

test("every literal className in the app is defined in design-system.css or globals.css", () => {
  const defined = definedClasses();
  const missing: string[] = [];

  for (const file of tsxFiles("src")) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/className="([^"{}]*)"/g)) {
      for (const token of m[1]!.split(/\s+/).filter(Boolean)) {
        if (NOT_OURS.has(token) || MARKERS_NOT_STYLES.has(token) || defined.has(token)) continue;
        const line = source.slice(0, m.index).split("\n").length;
        missing.push(`${file}:${line}  .${token}`);
      }
    }
  }

  assert.deepEqual(missing, [], `class used but defined in neither stylesheet:\n  ${missing.join("\n  ")}`);
});

test("the guard can fail: a class nobody defined is reported", () => {
  const defined = definedClasses();
  assert.ok(!defined.has("definitely-not-a-real-class"), "a made-up class must not resolve");
  assert.ok(defined.has("chip-remove"), "and a real one must, or the reader is broken");
  assert.ok(defined.has("soft"), "including one that lives in globals.css, not design-system.css");
});
