/**
 * `npm run dev`: the Next dev server wired to the LOCAL stack only.
 *
 * Starts `next dev` with the local database and local Supabase Auth, and
 * blanks every variable defined in .env / .env.local / .env.development*
 * (plus risky shell leftovers) except the AI Gateway credentials, so Gmail,
 * Google OAuth and cron secrets from production never reach it.
 * See src/lib/dev/localDevEnv.ts and README "Local development".
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { buildLocalDevEnv, shellLeakKeys } from "../src/lib/dev/localDevEnv";
import { DEV_DOTENV_FILES } from "../src/lib/dev/localDevGuard";

const root = path.join(__dirname, "..");
const keys = new Set<string>();
for (const f of DEV_DOTENV_FILES) {
  const p = path.join(root, f);
  if (existsSync(p)) for (const k of Object.keys(parseEnv(readFileSync(p, "utf8")))) keys.add(k);
}
for (const k of shellLeakKeys(process.env)) keys.add(k);

const env = { ...process.env, ...buildLocalDevEnv([...keys]), NODE_ENV: "development" as const };
console.log("[dev] local stack: database bd_contact_intel_dev on localhost:5432, Supabase Auth on 127.0.0.1:54321");
console.log("[dev] start it first with `npm run dev:stack` if it is not running.");

const child: ChildProcess = spawn("npx", ["next", "dev", ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit" });
child.on("exit", (code: number | null) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
