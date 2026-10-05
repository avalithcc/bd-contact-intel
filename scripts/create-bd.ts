/**
 * Owner-operated creation of a `bd` row, run BEFORE the new BD's first login.
 *
 * Why this exists: the app has no add-BD flow (no signup page, no invite, no
 * admin users screen). A `bd` row is created implicitly by
 * src/lib/queries.ts#getCurrentBd on the first authenticated request, and it
 * fills `name` with the email's local part (`user.email.split("@")[0]`), so
 * `emmanuel@avalith.net` would become the display name "emmanuel" — in task
 * assignment, the activity timeline, avatar initials and the reports BD
 * filter. And `bd.name` has NO edit UI anywhere: src/app/(app)/account/page.tsx
 * only renders it. So the name that lands at first login is the name forever,
 * unless someone edits the database by hand.
 *
 * Creating the row here first means `getCurrentBd` FINDS it instead of
 * inserting one, and the real name is correct from the first screen the new
 * BD sees. Run this BEFORE they log in; after they have logged in this script
 * refuses (the row already exists) and the name has to be fixed with an
 * UPDATE instead.
 *
 * This script does NOT create the Supabase auth user — that needs the
 * service-role key and stays a dashboard action (Authentication -> Add user,
 * with "Auto Confirm User" on, because `getCurrentBd` signs out anyone whose
 * `email_confirmed_at` is null). Order does not matter between the two
 * halves as long as BOTH are done before the first login; the script prints
 * the remaining steps.
 *
 * `role` is hardcoded to 'bd' and is deliberately NOT a flag. 'admin' opens
 * /admin/reports, /admin/audit-log and the migration gate (see
 * src/lib/auth/requireAdmin.ts); granting it should be a deliberate, separate
 * act, not one typo away in a convenience script.
 *
 * The email is lowercased before insert. `getCurrentBd` resolves the signed-in
 * user with an EXACT, case-sensitive `eq(bd.email, user.email)` and GoTrue
 * stores emails lowercased, so a row with any uppercase in it would never be
 * matched at login — getCurrentBd would try to insert a second row and hit
 * `bd_email_unique`. See the same reasoning in src/lib/auth/bdAuthMatch.ts
 * ("email_mismatch").
 *
 * Defaults to a DRY RUN: read-only, prints the current roster and the row that
 * would be inserted. `--execute --actor=<bd id>` inserts the `bd` row and ONE
 * `audit_log` row (action `bd_create`) in a single transaction, so the roster
 * and the audit trail can never disagree.
 *
 * Reversible, unlike a password reset: a mistaken row is removed with a
 * DELETE, as long as the new BD has not created any data yet (`contact`,
 * `task` and friends reference `bd.id`).
 *
 * Exit codes:
 *   0 = the bd row and its audit_log row were written (or a clean dry run)
 *   1 = nothing was written — bad arguments, email not an @avalith.net work
 *       email, a bd row with that email already exists, or the actor is not a
 *       real bd row
 *
 * Usage (do NOT run automatically: this touches the real database):
 *   npx tsx --env-file=.env.local scripts/create-bd.ts --name="Full Name" --email=someone@avalith.net
 *   npx tsx --env-file=.env.local scripts/create-bd.ts --name="Full Name" --email=someone@avalith.net --execute --actor=<bd id>
 *
 * Requires DATABASE_URL. Never prints the connection string.
 */
import { asc, eq } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, bd } from "../src/db/schema";
import { ALLOWED_WORK_EMAIL_DOMAIN, isAllowedWorkEmail } from "../src/lib/auth/allowedEmail";

interface Args {
  name: string | null;
  email: string | null;
  execute: boolean;
  actor: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let name: string | null = null;
  let email: string | null = null;
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false; // explicit no-op, dry-run is already the default
    else if (arg.startsWith("--name=")) name = arg.slice("--name=".length);
    else if (arg.startsWith("--email=")) email = arg.slice("--email=".length);
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else
      throw new Error(
        `Unknown argument: ${arg}. Valid: --name="Full Name", --email=<@avalith.net email>, --execute, --actor=<bd id>`,
      );
  }
  return { name, email, execute, actor };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const name = args.name?.trim() ?? "";
  // Lowercased so `getCurrentBd`'s case-sensitive lookup matches the email
  // GoTrue stores — see the file header.
  const email = args.email?.trim().toLowerCase() ?? "";

  if (!name || !email) {
    throw new Error(
      'Usage: npx tsx --env-file=.env.local scripts/create-bd.ts --name="Full Name" --email=<email> [--execute --actor=<bd id>]',
    );
  }
  if (args.execute && !args.actor) {
    throw new Error("--execute requires --actor=<bd id> for the audit log");
  }
  if (!isAllowedWorkEmail(email)) {
    console.error(
      `Refusing: ${email} is not a ${ALLOWED_WORK_EMAIL_DOMAIN} work email, so this BD could never sign in (src/lib/auth/allowedEmail.ts).`,
    );
    process.exitCode = 1;
    return;
  }

  const roster = await db
    .select({ id: bd.id, name: bd.name, email: bd.email, role: bd.role })
    .from(bd)
    .orderBy(asc(bd.createdAt));

  console.log(`Current roster (${roster.length} BDs):`);
  for (const row of roster) {
    console.log(`  ${row.name} <${row.email}>  role=${row.role}  id=${row.id}`);
  }

  // Case-insensitive, even though `bd_email_unique` is exact: an existing row
  // differing only in casing is exactly the login-breaking state the header
  // describes, so it must block too rather than add a second row.
  const clash = roster.find((row) => row.email.toLowerCase() === email);
  if (clash) {
    console.error(
      `\nRefusing: a bd row already exists for ${clash.email} (${clash.name}, id ${clash.id}).`,
    );
    console.error(
      "If the name is wrong because they already logged in once, fix it with an UPDATE — do not insert a second row.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nWould insert:  ${name} <${email}>  role=bd`);

  if (!args.execute) {
    console.log("\nDry run only — nothing was written.");
    console.log("Re-run with --execute --actor=<bd id> to create the row.");
    return;
  }

  const [actor] = await db.select({ id: bd.id }).from(bd).where(eq(bd.id, args.actor!)).limit(1);
  if (!actor) {
    console.error(`\nRefusing: --actor=${args.actor} does not match any bd row.`);
    process.exitCode = 1;
    return;
  }

  // One transaction: a bd row without its audit_log row would be a silent
  // addition to the roster, which is the whole thing this row exists to record.
  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(bd).values({ name, email }).returning();
    await tx.insert(auditLog).values({
      actorBdId: actor.id,
      action: "bd_create",
      targetBdId: row.id,
      metadata: {
        name: row.name,
        email: row.email,
        role: row.role,
        note:
          "Row created by scripts/create-bd.ts before the BD's first login, so " +
          "getCurrentBd would not derive the display name from the email local part.",
      },
    });
    return row;
  });

  console.log(`\nCreated bd row ${created.id} — ${created.name} <${created.email}> role=${created.role}`);
  console.log("audit_log row written (action bd_create).");
  console.log("\nRemaining steps before they can sign in:");
  console.log(
    `  1. Supabase dashboard -> Authentication -> Add user -> ${created.email}, with "Auto Confirm User" ON.`,
  );
  console.log(
    `  2. Issue the first password: npx tsx --env-file=.env.local scripts/reset-bd-password.ts --email=${created.email} --execute --actor=<bd id>`,
  );
  console.log("  3. Hand it over out of band and have them change it at /account/password.");
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
