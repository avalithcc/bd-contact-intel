/**
 * Guard: a class used under src/app must not resolve ONLY to descendant rules
 * (`.a .b`, `.a > .b`, `.a + .b`) whose required ancestor is absent. Such a class
 * renders with no style while "does this class exist in the stylesheet?" still
 * passes (this broke `.headline` and `.snippet`).
 *
 * How it works
 *  1. Parses src/app/design-system.css + globals.css with a regex (no CSS parser in
 *     the repo): comments stripped, `{...}` leaf blocks matched (so @media bodies
 *     work), attribute selectors and :not()/:is() arguments removed, selectors split
 *     on commas, then on combinators. A class is "nested-only" when every rule whose
 *     rightmost compound contains it has an ancestor/sibling compound.
 *  2. Collects class tokens from string literals inside `className=` in every
 *     .ts/.tsx under src/app.
 *  3. Cross-component ancestors: the ancestor may be laid down by another component,
 *     so a use is satisfied when ANY required ancestor class appears in a file
 *     directly inside the use's own directory or any parent directory up to src/app
 *     (siblings, page.tsx, layout.tsx). A parent normally lives at or above its
 *     children, so this covers cross-component ancestors without an import graph.
 *     Deliberately lenient (file granularity): it favours zero false positives.
 *
 * Does NOT catch: CSS modules, inline styles, classes built at runtime
 * (`dir-${x}` yields only the static fragment, which is skipped when it ends in "-"),
 * classes passed through props other than className, uses in src/components,
 * `.a.b` same-element compounds, rules whose ancestor is a bare element or `*`
 * (unverifiable, so skipped), an ancestor present in scope but not actually wrapping
 * the use, and the mockup stylesheets (a separate, cheaper assertion could diff
 * mockups/styles.css against the classes the mockups use; out of scope here).
 *
 * The size of that last miss, measured rather than guessed: of the six `.hint` orphans
 * this change fixed, this guard saw FOUR. The two in contacts/[id] (ChangeCompanyButton,
 * QuickActions) are invisible to it because a sibling, PropertyList.tsx, holds `.prop` —
 * they were found by reading the CSS by hand. Verified by reverting those two and watching
 * the guard stay green. So: a net win that found two classes nobody had noticed, NOT a
 * complete check. Tightening it would need real cross-component DOM ancestry, not a
 * directory scope.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const APP = join(process.cwd(), "src", "app");

type Info = { bare: boolean; ancestors: string[]; unverifiable: boolean };

export function nestedOnlyClasses(css: string): Map<string, string[]> {
  const info = new Map<string, Info>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const sel = m[1].trim();
    if (sel.startsWith("@")) continue;
    const stripped = sel.replace(/\[[^\]]*\]/g, "").replace(/:(?:not|is|where|has)\([^)]*\)/g, "");
    for (const one of stripped.split(",")) {
      const compounds = one.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean);
      if (!compounds.length) continue;
      const subject = compounds[compounds.length - 1];
      const ancestors = compounds.slice(0, -1);
      const ancClasses = ancestors.flatMap((c) => [...c.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map((x) => x[1]));
      const unverifiable = ancestors.some((c) => !/\./.test(c));
      for (const c of subject.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) {
        const cur = info.get(c[1]) ?? { bare: false, ancestors: [], unverifiable: false };
        if (!ancestors.length) cur.bare = true;
        cur.ancestors.push(...ancClasses);
        cur.unverifiable ||= unverifiable;
        info.set(c[1], cur);
      }
    }
  }
  const out = new Map<string, string[]>();
  for (const [k, v] of info) if (!v.bare && !v.unverifiable && v.ancestors.length) out.set(k, [...new Set(v.ancestors)]);
  return out;
}

/** Class tokens from the string/template literals inside every `className=` attribute. */
export function classNameTokens(src: string): string[] {
  const tokens: string[] = [];
  for (const m of src.matchAll(/className=\s*(?:"([^"]*)"|\{)/g)) {
    let expr = m[1] ?? "";
    if (m[1] === undefined) {
      let i = m.index! + m[0].length, depth = 1;
      const start = i;
      while (i < src.length && depth > 0) { if (src[i] === "{") depth++; else if (src[i] === "}") depth--; i++; }
      expr = [...src.slice(start, i - 1).matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map((x) => x[1] ?? x[2] ?? x[3]).join(" ");
    }
    for (const t of expr.replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) if (/^[a-z][\w-]*$/.test(t) && !t.endsWith("-")) tokens.push(t);
  }
  return tokens;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

export function findOrphans(nested: Map<string, string[]>, files: Map<string, string>) {
  const tokens = new Map([...files].map(([f, s]) => [f, new Set(classNameTokens(s))]));
  const orphans: string[] = [];
  for (const [file, used] of tokens) {
    const scope = new Set<string>();
    for (const [f, t] of tokens) {
      let inChain = false;
      for (let d = dirname(file); d.length >= APP.length; d = dirname(d)) if (dirname(f) === d) inChain = true;
      if (inChain) t.forEach((x) => scope.add(x));
    }
    for (const cls of used) {
      const need = nested.get(cls);
      if (need && !need.some((a) => scope.has(a))) orphans.push(`${file.slice(APP.length + 1)}: .${cls} needs ${need.map((a) => "." + a).join(" | ")}`);
    }
  }
  return orphans;
}

test("parser: flags a nested-only class, spares bare, grouped and @media-bare ones", () => {
  const css = `/* .x .y { } */ .a .b { c: d } .e { c: d } .e .f { c: d } .g, .h .i { c: d } @media (x) { .j .k { c: d } .k { c: d } }`;
  const n = nestedOnlyClasses(css);
  assert.deepEqual([...n.keys()].sort(), ["b", "f", "i"]);
});

test("parser: attribute selectors do not hide the subject class", () => {
  assert.equal(nestedOnlyClasses(`.chip[aria-pressed="mixed"] { c: d }`).size, 0);
});

test("scope: ancestor in a sibling component of the same route satisfies, other route does not", () => {
  const nested = new Map([["child", ["parent"]]]);
  const f = (p: string) => join(APP, "(app)", p);
  const files = new Map([
    [f("r1/page.tsx"), `<div className="parent"><Kid/></div>`],
    [f("r1/_c/Kid.tsx"), `<p className="child" />`],
    [f("r2/Kid.tsx"), `<p className="child" />`],
  ]);
  const o = findOrphans(nested, files);
  assert.equal(o.length, 1);
  assert.match(o[0], /r2/);
});

test("src/app: no class is used where only a nested rule styles it and its ancestor is absent", () => {
  const css = ["design-system.css", "globals.css"].map((n) => readFileSync(join(APP, n), "utf8")).join("\n");
  const nested = nestedOnlyClasses(css);
  assert.ok(nested.size > 10, `expected many nested-only classes, got ${nested.size}`);
  const files = new Map(walk(APP).map((f) => [f, readFileSync(f, "utf8")] as const));
  const orphans = findOrphans(nested, files);
  assert.deepEqual(orphans, [], `${orphans.length} orphan use(s):\n${orphans.join("\n")}`);
});
