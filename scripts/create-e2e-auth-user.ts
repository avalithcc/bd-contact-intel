/**
 * Creates (or repairs) the e2e logins (the BD account and an admin one) in the LOCAL Supabase Auth stack
 * (`supabase start`, see tests/e2e/README.md). Idempotent: run it after every
 * `supabase stop --no-backup` / stack rebuild.
 *
 *   npx tsx scripts/create-e2e-auth-user.ts            # dry run: prints what it would do
 *   npx tsx scripts/create-e2e-auth-user.ts --execute  # creates or updates the user
 *
 * Reads E2E_SUPABASE_URL, E2E_EMAIL and E2E_PASSWORD from the shell, falling
 * back to `.env.e2e.local` (the same file the Playwright config reads for a
 * scratch run). It never reads `.env` or `.env.local`, so the production
 * SUPABASE_SERVICE_ROLE_KEY and the production E2E credentials cannot reach it.
 * The service-role key comes from E2E_SUPABASE_SERVICE_ROLE_KEY, or from
 * `supabase status -o json` (the local stack's own well-known demo key).
 *
 * Refuses unless E2E_SUPABASE_URL is a loopback address (isLocalSupabaseUrl):
 * this script sets a password and pre-confirms the email, which must never be
 * pointed at a hosted project. Creates the user with the email already
 * confirmed (src/lib/queries.ts#getCurrentBd signs out unconfirmed accounts),
 * or, when it exists, resets its password and confirms it. Prints neither the
 * password nor any key. Writes only to the local Auth schema, no app table.
 *
 * Revert: delete the user in Studio (http://127.0.0.1:54323 > Authentication)
 * or `supabase stop --no-backup`.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { SCRATCH_DOTENV_FILE, isLocalSupabaseUrl } from "../tests/e2e/supabaseIsolation";

const envFile = path.join(__dirname, "..", SCRATCH_DOTENV_FILE);
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const execute = process.argv.includes("--execute");
const url = process.env.E2E_SUPABASE_URL?.trim();
const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;
const adminEmail = (process.env.E2E_ADMIN_EMAIL?.trim() || "admin-e2e@avalith.net").toLowerCase();

function serviceRoleKey(): string {
  const fromEnv = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (fromEnv) return fromEnv;
  const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }));
  if (!status.SERVICE_ROLE_KEY) throw new Error("`supabase status` returned no SERVICE_ROLE_KEY. Is the stack running?");
  return status.SERVICE_ROLE_KEY;
}

async function main() {
  if (!isLocalSupabaseUrl(url)) {
    throw new Error("E2E_SUPABASE_URL must be set to the local stack (http://127.0.0.1:54321). Refusing to touch any other Supabase project.");
  }
  if (!email) throw new Error("E2E_EMAIL is required");
  if (!password?.trim()) throw new Error("E2E_PASSWORD is required");

  const supabase = createClient(url!, serviceRoleKey(), { auth: { autoRefreshToken: false, persistSession: false } });
  // The local stack holds a handful of users, one page is enough.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Cannot list local auth users: ${error.message}`);

  // The e2e login, plus a second one for the specs that need an admin session next to the BD (sequences-admin.spec.ts).
  // Same password; the app role comes from the `bd` row, which that spec upserts itself.
  for (const account of [email, adminEmail]) {
    const existing = data.users.find((u) => u.email?.toLowerCase() === account.toLowerCase());
    console.log(`[e2e-auth] ${execute ? "EXECUTE" : "DRY RUN"}: ${existing ? "update" : "create"} ${account} on ${new URL(url!).origin}`);
    if (!execute) continue;
    const result = existing
      ? await supabase.auth.admin.updateUserById(existing.id, { password, email_confirm: true })
      : await supabase.auth.admin.createUser({ email: account, password, email_confirm: true });
    if (result.error) throw new Error(`Local auth write failed: ${result.error.message}`);
    console.log(`[e2e-auth] ${existing ? "updated" : "created"} ${account} (email confirmed)`);
  }
  if (!execute) console.log("[e2e-auth] nothing written. Re-run with --execute.");
}

main().catch((e) => {
  console.error(`[e2e-auth] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
