/**
 * Owner-run check that Supabase refuses a password change made WITHOUT the
 * current password — i.e. that the project setting "require current password"
 * is really on, so a stolen session cannot skip /account/password's form and
 * call the Auth API directly.
 *
 * Run it in your OWN terminal (it asks for your password; never paste the
 * output anywhere):
 *
 *   npx tsx --env-file=.env.local scripts/check-password-change-guard.ts --email=<your email>
 *
 * What it does:
 *   1. Signs in with your email and the password you type (input is hidden).
 *   2. Calls updateUser({ password: <random> }) WITHOUT current_password —
 *      exactly what an attacker holding your session would do.
 *   3. Expected: Supabase REJECTS it. Your password is unchanged. Exit 0.
 *
 * If the setting is OFF, step 2 succeeds and your password becomes the random
 * value, which is printed ONCE so you are not locked out. Exit 1. Sign in with
 * it and change it at /account/password.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const mutable = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    mutable._writeToOutput = (s: string) => {
      if (s.includes(prompt)) mutable.output.write(s);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const email = process.argv.find((a) => a.startsWith("--email="))?.slice("--email=".length).trim();
  if (!email) throw new Error("Usage: --email=<your email>");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing — run with --env-file=.env.local");

  const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = await readHidden(`Current password for ${email}: `);
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Sign-in failed (${signInError.code ?? signInError.status}); nothing was changed.`);

  const probe = `Probe-${randomBytes(9).toString("base64url")}9!`;
  const { error } = await supabase.auth.updateUser({ password: probe });
  await supabase.auth.signOut();

  if (error) {
    console.log(`PROTECTED ✓ — Supabase refused the change without the current password (${error.code ?? error.status}).`);
    console.log("Your password is unchanged.");
    process.exit(0);
  }
  console.log("NOT PROTECTED ✗ — the change was accepted without the current password.");
  console.log("Your password is now (shown once, change it at /account/password):");
  console.log(`  ${probe}`);
  process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(2);
});
