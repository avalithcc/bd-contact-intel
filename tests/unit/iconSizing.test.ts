/**
 * Every icon from `@/components/icons` must carry the design-system `icon`
 * class (or a class that composes it, like `icon icon-lg`).
 *
 * The shared `Svg` wrapper sets only a `viewBox`, no width/height — size
 * comes from `.icon` in design-system.css (16x16), exactly as every approved
 * mockup marks its SVGs `class="icon"`. An icon that gets only a CSS-module
 * class renders unsized, and an unsized inline SVG stretches to fill its
 * container. That is how /account and /account/email showed a mail icon and
 * chevrons hundreds of pixels wide for three days (restyle bb2acdf,
 * 2026-09-26, found by the owner on 2026-09-29).
 *
 * A static scan, so the next page that drops the class fails here instead
 * of in front of a user.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";
const ICONS_MODULE = /import\s*\{([^}]*)\}\s*from\s*["']@\/components\/icons["']/g;

function iconViolations(): string[] {
  const files = (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => join(SRC, f))
    .filter((f) => !f.endsWith(join("components", "icons.tsx")));
  const violations: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const imported = new Set<string>();
    for (const m of src.matchAll(ICONS_MODULE)) {
      for (const name of m[1].split(",")) {
        const local = name.trim().split(/\s+as\s+/).pop()?.trim();
        if (local) imported.add(local);
      }
    }
    if (!imported.size) continue;
    for (const m of src.matchAll(/<([A-Z]\w*)\b([^>]*?)\/?>/gs)) {
      if (!imported.has(m[1])) continue;
      const cls = m[2].match(/className=(\{[^}]*\}|"[^"]*")/s)?.[1] ?? "";
      // `styles.foo` names never count as the design-system `icon` token.
      if (!/\bicon\b/.test(cls.replace(/styles\.\w+/g, ""))) {
        const line = src.slice(0, m.index).split("\n").length;
        violations.push(`${file}:${line} <${m[1]} ${cls || "(no className)"}>`);
      }
    }
  }
  return violations;
}

test("every icon from @/components/icons carries the design-system `icon` size class", () => {
  const violations = iconViolations();
  assert.deepEqual(violations, [], `unsized icons (add the \`icon\` class):\n${violations.join("\n")}`);
});

test("the scan actually finds icon usages (guards against a silently broken regex)", () => {
  const files = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith(".tsx"));
  const importing = files.filter((f) => /from\s*["']@\/components\/icons["']/.test(readFileSync(join(SRC, f), "utf8")));
  assert.ok(importing.length >= 5, `expected several files importing icons, found ${importing.length}`);
});
