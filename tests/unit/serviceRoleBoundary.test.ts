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
