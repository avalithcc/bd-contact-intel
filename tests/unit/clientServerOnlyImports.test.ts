/**
 * Tripwire: `src/lib/whatsapp.ts` (and libphonenumber-js behind it) is
 * server-only BY INTENT. Its metadata is ~80 kB; a "use client" file that
 * reaches it, directly or through any chain of local imports, ships that to
 * every visitor with no error and no warning. Nothing else enforces the rule,
 * and `import "server-only"` is not an option because it throws under
 * `tsx --test`. So the rule is a red test, the same move as the drizzle
 * journal guard.
 *
 * It is a regex over import specifiers, not a bundler: enough to catch the
 * mistake, deliberately not smart. Type-only imports are erased at build time
 * and ignored.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const SERVER_ONLY_FILE = path.resolve("src/lib/whatsapp.ts");
const SERVER_ONLY_PACKAGE = "libphonenumber-js";

const USE_CLIENT = /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*["']use client["']/;
const SPECIFIER = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^"';]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

export interface Fs {
  read(file: string): string;
  exists(file: string): boolean;
}

function resolveLocal(spec: string, from: string, fs: Fs): string | null {
  const base = spec.startsWith("@/") ? path.resolve("src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (/\.tsx?$/.test(c) && fs.exists(c)) return c;
  }
  return null;
}

/** The chain of files from `entry` to a server-only module, or null. */
export function findServerOnlyChain(entry: string, fs: Fs): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    for (const m of fs.read(file).matchAll(SPECIFIER)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec === SERVER_ONLY_PACKAGE || spec.startsWith(`${SERVER_ONLY_PACKAGE}/`)) return [...chain, spec];
      const next = resolveLocal(spec, file, fs);
      if (!next) continue;
      if (next === SERVER_ONLY_FILE) return [...chain, next];
      const found = walk(next, [...chain, next]);
      if (found) return found;
    }
    return null;
  };
  return walk(entry, [entry]);
}

const realFs: Fs = { read: (f) => readFileSync(f, "utf8"), exists: (f) => existsSync(f) };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

test("no 'use client' file reaches whatsapp.ts or libphonenumber-js", () => {
  const offenders = sourceFiles("src")
    .map((f) => path.resolve(f))
    .filter((f) => USE_CLIENT.test(realFs.read(f)))
    .flatMap((f) => {
      const chain = findServerOnlyChain(f, realFs);
      return chain ? [chain.map((c) => path.relative(".", c)).join(" -> ")] : [];
    });
  assert.deepEqual(offenders, [], "server-only module reached from client code; compute on the server and pass a prop (see PropertyList)");
});

test("the tripwire itself: finds direct, transitive and package imports, ignores type-only ones", () => {
  const files: Record<string, string> = {
    [path.resolve("src/a.tsx")]: '"use client";\nimport { x } from "./b";',
    [path.resolve("src/b.ts")]: 'import { whatsappLink } from "@/lib/whatsapp";',
    [path.resolve("src/lib/whatsapp.ts")]: 'import p from "libphonenumber-js/min";',
    [path.resolve("src/c.tsx")]: "'use client'\nimport type { W } from \"@/lib/whatsapp\";\nimport { y } from \"./d\";",
    [path.resolve("src/d.ts")]: "export const y = 1;",
    [path.resolve("src/e.tsx")]: '"use client";\nimport lib from "libphonenumber-js";',
  };
  const fs: Fs = { read: (f) => files[f], exists: (f) => f in files };
  assert.deepEqual(findServerOnlyChain(path.resolve("src/a.tsx"), fs)?.map((c) => path.relative(".", c)), ["src/a.tsx", "src/b.ts", "src/lib/whatsapp.ts"]);
  assert.equal(findServerOnlyChain(path.resolve("src/c.tsx"), fs), null);
  assert.ok(findServerOnlyChain(path.resolve("src/e.tsx"), fs));
  assert.ok(USE_CLIENT.test(files[path.resolve("src/a.tsx")]));
  assert.ok(USE_CLIENT.test(files[path.resolve("src/c.tsx")]));
});
