/**
 * Owner-operated password reset for a BD — the FALLBACK for when email does
 * not reach them. It is not the normal path.
 *
 * The normal paths are both email-based and both work: a BD resets their own
 * password at /forgot-password (ON since 2026-09-29 — see
 * src/lib/auth/passwordReset.ts), and a new BD is onboarded with a Supabase
 * invite, whose link lands on /auth/confirm, confirms the email, opens a
 * session and drops them at /account/password to choose their own password
 * (see src/lib/auth/confirmType.ts). Neither puts a password in the owner's
 * hands, which is why they are preferred.
 *
 * This script is for when that fails: the invite or reset mail never arrives,
 * the link expired, or the custom SMTP credentials are revoked. The only way
 * left to set a password directly is the Supabase Auth admin API with the
 * service-role key, which is why this is a script an owner runs by hand, not
 * a UI button.
 *
 * NOTE (history): until 2026-09-29 this script was the ONLY recovery path,
 * because the project had no custom SMTP and Supabase's built-in email
 * service only delivers to members of the project's own team — it could not
 * reach a BD at all. That is no longer true; do not reach for this script
 * before trying the email paths above.
 *
 * LIMITATION: this sets the password and NOTHING else. It does not touch
 * `email_confirmed_at`, so it CANNOT onboard a BD who was invited but never
 * accepted: src/lib/queries.ts#getCurrentBd signs out anyone whose email is
 * unconfirmed and redirects to /login?error=not_authorized, password or no
 * password. Such a BD needs the invite accepted (or the email confirmed
 * separately) first.
 *
 * Defaults to a DRY RUN: read-only, resolves the target `bd` row AND the
 * matching `auth.users` row (see src/lib/auth/bdAuthResolveDb.ts,
 * src/lib/auth/bdAuthMatch.ts) and prints what would happen. Never prints a
 * password. Does not need SUPABASE_SERVICE_ROLE_KEY.
 *
 * `--execute --actor=<bd id>` generates a temporary password
 * (src/lib/auth/tempPassword.ts), sets it via
 * `supabase.auth.admin.updateUserById`, and writes ONE `audit_log` row
 * (action `bd_password_reset`) recording who did it, for whom, and when.
 *
 * SUPABASE_SERVICE_ROLE_KEY is read ONLY in this file, never in `src/` —
 * `rg SUPABASE_SERVICE_ROLE_KEY src/` must stay empty so the key can never
 * be reachable from app code (see the file-header note in
 * src/lib/auth/bdAuthResolveDb.ts, which resolves everything the dry run
 * needs without it).
 *
 * Order on `--execute` (NOT one DB transaction — the admin API call is an
 * external HTTP request, not a Postgres statement, so it cannot join a
 * transaction with the audit insert):
 *   1. Validate --actor is a real bd row (cheap read, before touching the
 *      admin API — a bad --actor must never cause a real password change).
 *   2. Validate the service-role env vars are present.
 *   3. Generate the temporary password.
 *   4. Call the admin API. If it fails, throw — nothing else runs, nothing
 *      is written, this exits non-zero.
 *   5. Write the audit_log row. If THIS fails, the password has already
 *      changed — still print the temporary password (never silently
 *      locking the BD out) and report the audit failure loudly.
 *
 * This is IRREVERSIBLE — there is no previous password to restore. A
 * mistaken reset is corrected by resetting again for the intended target,
 * not by any kind of undo. The `audit_log` row records this explicitly.
 *
 * Exit codes (see src/lib/auth/passwordResetExitCode.ts for the 0/2 split):
 *   0 = password reset AND the audit_log row was written
 *   1 = nothing changed — bad arguments, target/actor could not be
 *       resolved, the admin API call itself failed, etc.
 *   2 = the password WAS changed via the Supabase admin API, but the
 *       audit_log insert failed afterward. Never 0 here — the operator must
 *       notice the write is out of sync with the audit trail. The printed
 *       temporary password is still valid; act on it, then fix the audit
 *       trail by hand if needed.
 *
 * Usage:
 *   npx tsx scripts/reset-bd-password.ts --email=<bd email>                          # dry run
 *   npx tsx scripts/reset-bd-password.ts --email=<bd email> --execute --actor=<bd id> # writes
 *
 * Requires DATABASE_URL (dry run and execute). `--execute` additionally
 * requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Never
 * prints the connection string or the service-role key.
 */
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, bd } from "../src/db/schema";
import { BdAuthMatchError, type BdAuthMatch } from "../src/lib/auth/bdAuthMatch";
import { resolveBdAuthUser } from "../src/lib/auth/bdAuthResolveDb";
import { passwordResetExitCode } from "../src/lib/auth/passwordResetExitCode";
import { generateTempPassword } from "../src/lib/auth/tempPassword";

interface Args {
  email: string | null;
  execute: boolean;
  actor: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let email: string | null = null;
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false; // explicit no-op, dry-run is already the default
    else if (arg.startsWith("--email=")) email = arg.slice("--email=".length);
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --email=<bd email>, --execute, --actor=<bd id>`);
  }
  return { email, execute, actor };
}

interface BdPasswordResetResult {
  temporaryPassword: string;
  auditWritten: boolean;
  auditError?: string;
}

/**
 * The only function in this repo that reads SUPABASE_SERVICE_ROLE_KEY or
 * constructs a Supabase admin client. Deliberately kept out of `src/` (see
 * file header) — never import this from app code.
 */
async function executeBdPasswordReset(params: {
  actorBdId: string;
  target: BdAuthMatch;
}): Promise<BdPasswordResetResult> {
  const { actorBdId, target } = params;

  const [actor] = await db.select({ id: bd.id }).from(bd).where(eq(bd.id, actorBdId)).limit(1);
  if (!actor) {
    throw new Error(`--actor=${actorBdId} does not match any bd row.`);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  }
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (owner-run scripts only — never prefix it NEXT_PUBLIC_).",
    );
  }

  const temporaryPassword = generateTempPassword();

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin.auth.admin.updateUserById(target.authUser.id, {
    password: temporaryPassword,
  });
  if (error) {
    // Nothing written yet — fail loudly, write nothing.
    throw new Error(`Supabase admin updateUserById failed: ${error.message}`);
  }

  try {
    await db.insert(auditLog).values({
      actorBdId,
      action: "bd_password_reset",
      targetBdId: target.bd.id,
      // Never the password or any hash of it — just enough to audit WHO
      // reset WHOSE password and WHEN, and to make the irreversibility
      // explicit for whoever reads this row later.
      metadata: {
        targetEmail: target.bd.email,
        authUserId: target.authUser.id,
        irreversible: true,
        note:
          "Password was set directly via the Supabase Auth admin API, the " +
          "owner-run fallback for when the email paths (/forgot-password, or " +
          "an invite link) do not reach the BD. There is no revert path; if " +
          "this was a mistake, run the script again for the correct target.",
      },
    });
    return { temporaryPassword, auditWritten: true };
  } catch (err) {
    return {
      temporaryPassword,
      auditWritten: false,
      auditError: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    throw new Error(
      "Usage: npx tsx scripts/reset-bd-password.ts --email=<bd email> [--execute --actor=<bd id>]",
    );
  }
  if (args.execute && !args.actor) {
    throw new Error("--execute requires --actor=<bd id> for the audit log");
  }

  let match: BdAuthMatch;
  try {
    match = await resolveBdAuthUser(args.email);
  } catch (err) {
    if (err instanceof BdAuthMatchError) {
      console.error(`Cannot resolve target: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  console.log(`Target BD:      ${match.bd.name} <${match.bd.email}> (bd id ${match.bd.id}, role ${match.bd.role})`);
  console.log(`Auth user id:   ${match.authUser.id}`);
  console.log(
    `Last sign-in:   ${match.authUser.lastSignInAt ? match.authUser.lastSignInAt.toISOString() : "never"}`,
  );
  console.log(`Auth created:   ${match.authUser.createdAt.toISOString()}`);

  if (!args.execute) {
    console.log(
      "\nDry run only — a temporary password would be generated and set via the Supabase admin API.",
    );
    console.log("Re-run with --execute --actor=<bd id> to actually reset the password.");
    return;
  }

  console.log(`\nResetting password for ${match.bd.email} (actor bd id ${args.actor})...`);
  const result = await executeBdPasswordReset({ actorBdId: args.actor!, target: match });

  if (!result.auditWritten) {
    console.error(
      "\nWARNING: the password WAS changed via the Supabase admin API, but writing the audit_log row " +
        `failed: ${result.auditError}. Recording this manually is recommended.`,
    );
  } else {
    console.log("\nPassword reset. One audit_log row written (action: bd_password_reset).");
  }
  // 0 when audited, 2 (never 0, never the generic 1) when the password
  // changed but the audit_log row failed to write — see the header comment.
  process.exitCode = passwordResetExitCode(result.auditWritten);

  console.log("\n=== TEMPORARY PASSWORD (shown once, not stored anywhere) ===");
  console.log(result.temporaryPassword);
  console.log("==============================================================");
  console.log(
    `Tell ${match.bd.name} to sign in with it and change it immediately at /account/password.`,
  );
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
