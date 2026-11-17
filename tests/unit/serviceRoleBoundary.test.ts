/**
 * The Supabase service-role key bypasses every RLS policy. Its only home is src/lib/supabase/serviceRole.ts, and no
 * "use client" file may import it (or the DB-backed attachment modules). Regex over source, like clientBoundaryExports.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const USE_CLIENT = /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*["']use client["']/;
const FORBIDDEN = [/supabase\/serviceRole/, /email\/attachments\/queries/, /email\/recipients\/queries/, /SUPABASE_SERVICE_ROLE_KEY/];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

test("no 'use client' file reaches the service-role client or the DB-backed attachment modules", () => {
  const offenders: string[] = [];
  for (const file of walk("src")) {
    const src = readFileSync(file, "utf8");
    if (!USE_CLIENT.test(src)) continue;
    if (FORBIDDEN.some((re) => re.test(src))) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test("the service-role key is read in exactly one module", () => {
  const readers = walk("src").filter((f) => readFileSync(f, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.deepEqual(readers.map((f) => f.split(path.sep).join("/")), ["src/lib/supabase/serviceRole.ts"]);
});

/**
 * The same boundary, followed TRANSITIVELY. The check above reads one file's own text, so it cannot see a client
 * component that reaches the database through an innocent-looking helper. That is exactly how `node:fs` landed in the
 * client bundle on 2026-11-17: QuickActions.tsx (client) imported a pure-looking date helper that also exported a
 * server lookup doing `await import("@/db")`. Webpack traces a dynamic import too.
 *
 * `npm run lint` passed and all 6087 unit tests passed. ONLY `npx next build` caught it, with an error naming
 * node:fs rather than either file. This walks the local import graph so the next one fails here, by name.
 */
test("no 'use client' file reaches the database, however many hops away", () => {
  const files = walk("src");
  const read = new Map(files.map((f) => [f.split(path.sep).join("/"), readFileSync(f, "utf8")]));
  // `import type` is erased at compile time, so it cannot put anything in a bundle. Only value imports count.
  const IMPORT = /(?:^|\n)\s*(?:import|export)(?!\s+type\s)[^'"\n]*from\s*["'](@\/[^"']+)["']|\bimport\(\s*["'](@\/[^"']+)["']\s*\)/g;
  // A "use server" module is a real boundary: Next replaces its exports with RPC stubs, so its body never ships to the
  // client. Traversal stops there, which is why 17 live chains through contacts/actions.ts are correct, not offences.
  const USE_SERVER = /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*["']use server["']/;
  // The CONNECTION only. "@/db/schema" is table definitions and types: it opens nothing, pulls no node builtin, and
  // 43 client components already import it with a green build. Treating the two alike reported all 43 as offenders,
  // which would have buried the one real case - a guard that cries about correct code gets deleted.
  const DB = /^@\/db$/;

  // "@/x/y" -> the file that actually holds it; the repo writes extensionless specifiers.
  const resolve = (spec: string): string | null => {
    const base = `src/${spec.slice(2)}`;
    for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (read.has(cand)) return cand;
    return null;
  };

  const chainToDb = (start: string): string[] | null => {
    const seen = new Set<string>();
    const stack: { file: string; path: string[] }[] = [{ file: start, path: [start] }];
    while (stack.length > 0) {
      const { file, path: trail } = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = read.get(file);
      if (src === undefined) continue;
      if (file !== start && USE_SERVER.test(src)) continue;
      for (const m of src.matchAll(IMPORT)) {
        const spec = m[1] ?? m[2]!;
        if (DB.test(spec)) return [...trail, spec];
        const next = resolve(spec);
        // A nested "use client" module is still client code, so keep walking into it.
        if (next !== null && !seen.has(next)) stack.push({ file: next, path: [...trail, next] });
      }
    }
    return null;
  };

  const offenders: string[] = [];
  for (const [file, src] of read) {
    if (!USE_CLIENT.test(src)) continue;
    const chain = chainToDb(file);
    if (chain !== null) offenders.push(chain.join(" -> "));
  }
  assert.deepEqual(offenders, [], "a client component reaches @/db through these imports; move the server half to its own module");
});
