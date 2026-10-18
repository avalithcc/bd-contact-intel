/**
 * Tripwire for the RSC client boundary. A "use client" module is replaced, on the
 * server, by client references: only React components survive the crossing. A
 * plain function, constant or class exported from such a file and CALLED from a
 * server component compiles, typechecks and passes unit tests, then throws
 * "Attempted to call X() from the server but X is on the client" at render. That
 * is how `pickCallFormLabels()` (exported from CallForm.tsx) broke every
 * logged-in page in production.
 *
 * Rule: a file without "use client" may import, from a "use client" file, only
 * names that look like components (PascalCase with a lowercase letter). Anything
 * else (camelCase helpers, hooks, UPPER_CASE constants) must live in a neutral
 * module. Type-only imports/exports are erased and ignored. Regex over source,
 * deliberately not a compiler: enough to catch the mistake.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const USE_CLIENT = /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*["']use client["']/;

/** `importer -> module#name` entries that are knowingly allowed. Keep empty unless justified. */
const ALLOWLIST = new Set<string>([]);

export interface Fs {
  read(file: string): string;
  exists(file: string): boolean;
}

export function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) && /[a-z]/.test(name);
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

function parseSpecifierList(list: string): string[] {
  return list
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !/^type\s/.test(s))
    .map((s) => s.split(/\s+as\s+/)[0].trim());
}

/** Imported names (original names, not local aliases) of non-type named imports and `export {..} from`. */
export function namedImports(src: string): { spec: string; names: string[] }[] {
  const out: { spec: string; names: string[] }[] = [];
  const re = /(?:^|[\n;])\s*(import|export)\s+(?!type\b)([^;'"]*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of stripComments(src).matchAll(re)) {
    const brace = m[2].match(/\{([\s\S]*)\}/);
    if (!brace) continue; // default or namespace import, or `export *`
    out.push({ spec: m[3], names: parseSpecifierList(brace[1]) });
  }
  return out;
}

/** Named VALUE exports of a module (types skipped). Names are as seen by importers. */
export function valueExports(src: string): string[] {
  const code = stripComments(src);
  const names: string[] = [];
  for (const m of code.matchAll(/(?:^|[\n;])\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  for (const m of code.matchAll(/(?:^|[\n;])\s*export\s+(?!type\b)\{([^}]*)\}/g)) {
    for (const s of m[1].split(",").map((x) => x.trim()).filter((x) => x && !/^type\s/.test(x))) {
      const exported = s.split(/\s+as\s+/).pop()!.trim();
      if (exported !== "default") names.push(exported);
    }
  }
  return names;
}

function resolveLocal(spec: string, from: string, fs: Fs): string | null {
  const base = spec.startsWith("@/") ? path.resolve("src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (/\.tsx?$/.test(c) && fs.exists(c)) return c;
  }
  return null;
}

/** Violations as `importer -> module#name` for every non-client file in `files`. */
export function findClientBoundaryViolations(files: string[], fs: Fs): string[] {
  const clientFiles = new Set(files.filter((f) => USE_CLIENT.test(fs.read(f))));
  const clientNonComponents = new Map<string, Set<string>>();
  for (const f of clientFiles) {
    clientNonComponents.set(f, new Set(valueExports(fs.read(f)).filter((n) => !isComponentName(n))));
  }
  const out: string[] = [];
  for (const file of files) {
    if (clientFiles.has(file)) continue;
    for (const { spec, names } of namedImports(fs.read(file))) {
      const target = resolveLocal(spec, file, fs);
      const bad = target ? clientNonComponents.get(target) : undefined;
      if (!bad) continue;
      for (const name of names) {
        if (!bad.has(name)) continue;
        const entry = `${path.relative(".", file)} -> ${spec}#${name}`;
        if (!ALLOWLIST.has(entry)) out.push(entry);
      }
    }
  }
  return out.sort();
}

const realFs: Fs = { read: (f) => readFileSync(f, "utf8"), exists: (f) => existsSync(f) };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [path.resolve(full)] : [];
  });
}

test("no server file imports a non-component value from a 'use client' file", () => {
  const files = sourceFiles("src");
  assert.ok(files.some((f) => USE_CLIENT.test(realFs.read(f))), "found no 'use client' files: the scan is broken");
  assert.deepEqual(
    findClientBoundaryViolations(files, realFs),
    [],
    "a server module calls a plain export of a 'use client' file; move the helper to a neutral module (see the CallForm labels incident)",
  );
});

test("the tripwire itself: reports server importers of client non-components, not client importers", () => {
  const p = (f: string) => path.resolve(f);
  const content: Record<string, string> = {
    [p("src/components/CallForm.tsx")]:
      '"use client";\nexport function CallForm() {}\nexport function pickCallFormLabels() {}\nexport const MAX_NOTES = 3;\nexport type Props = {};\nexport interface X {}\nexport class Helper {}\nexport { useThing, Widget as Gadget, type Skip };',
    [p("src/app/page.tsx")]:
      'import { CallForm,\n  pickCallFormLabels,\n  type Props } from "@/components/CallForm";\nimport Def, { MAX_NOTES, Helper as H } from "@/components/CallForm";\nexport { useThing } from "@/components/CallForm";\nimport { Gadget } from "@/components/CallForm";\nimport type { X } from "@/components/CallForm";\n// import { nope } from "@/components/CallForm";',
    [p("src/components/Other.tsx")]: '"use client";\nimport { pickCallFormLabels } from "./CallForm";',
  };
  const fs: Fs = { read: (f) => content[f], exists: (f) => f in content };
  assert.deepEqual(valueExports(content[p("src/components/CallForm.tsx")]).sort(), [
    "CallForm",
    "Gadget",
    "Helper",
    "MAX_NOTES",
    "pickCallFormLabels",
    "useThing",
  ]);
  assert.deepEqual(findClientBoundaryViolations(Object.keys(content), fs), [
    "src/app/page.tsx -> @/components/CallForm#MAX_NOTES",
    "src/app/page.tsx -> @/components/CallForm#pickCallFormLabels",
    "src/app/page.tsx -> @/components/CallForm#useThing",
  ]);
});
