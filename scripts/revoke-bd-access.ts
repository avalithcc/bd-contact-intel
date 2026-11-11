/**
 * Owner-operated ACCESS REVOCATION for a BD who left the company. It blocks
 * sign-in and nothing else: no row is deleted, no contact is reassigned, no
 * mail is stopped.
 *
 * WHY A BAN AND NOT A DELETE — the one thing to understand before reading on:
 * deleting the `bd` row does NOT lock anybody out. The CRM provisions a `bd`
 * row on first sign-in, and in production that provisioning is
 * unconditional: src/lib/auth/bdProvisioning.ts#mayProvisionBd returns true
 * outright when NODE_ENV is "production". So a deleted BD who still has
 * Supabase credentials signs in, gets a brand-new empty `bd` row, and is
 * inside the CRM again — with their history destroyed for nothing. The same
 * goes for clearing the email or flipping a role: the session gate
 * (src/lib/supabase/middleware.ts) only asks Supabase Auth whether there is
 * a user, whether the address is @avalith.net, and whether it is confirmed.
 * It never consults the `bd` table. The only layer that can actually refuse
 * the sign-in is Supabase Auth itself, so that is the layer this touches.
 *
 * WHAT IT DOES: sets `banned_until` a century out on the matching
 * `auth.users` row via the Auth admin API. A banned user cannot sign in, and
 * any session they already hold dies on their next request — the middleware
 * calls `supabase.auth.getUser()` on every request, which validates against
 * GoTrue server-side and fails for a banned account, so they are bounced to
 * /login rather than coasting on a cached cookie.
 *
 * WHAT IT DELIBERATELY LEAVES ALONE: everything the departing BD touched.
 * Their contacts, people, activities, tasks, meetings and audit history keep
 * pointing at their `bd` row, which is what makes the history readable.
 * scripts/measure/bd-footprint.ts prints that footprint; for anyone who has
 * actually worked, the blocking references make a delete impossible anyway.
 * Reassigning their book of business and disconnecting their Gmail mailbox
 * (`email_account`) are separate, deliberate decisions — this script does
 * NOT make them, and revoking access does not stop a connected mailbox from
 * continuing to sync.
 *
 * REVERSIBLE: unlike scripts/reset-bd-password.ts, this one can be undone —
 * clearing the ban (`ban_duration: "none"`) restores the account exactly as
 * it was. That is why it is the right tool for "they left" and also for
 * "they left and might come back".
 *
 * PROOF, NOT TRUST: the admin API reporting success is not evidence. After
 * the call the script reads `banned_until` back out of `auth.users` and
 * checks it is genuinely far-future (src/lib/auth/accessRevocation.ts).
 * A ban the server interpreted as hours instead of a century would otherwise
 * print "access revoked" and wear off unnoticed.
 *
 * IDEMPOTENT: an account that is already banned or already deleted is
 * reported as such and exits 0 without touching anything.
 *
 * SUPABASE_SERVICE_ROLE_KEY is read ONLY in this file and in
 * scripts/reset-bd-password.ts, never in `src/` — `rg
 * SUPABASE_SERVICE_ROLE_KEY src/` must stay empty so the key can never be
 * reachable from app code.
 *
 * Order on `--execute` (NOT one DB transaction — the admin API call is an
 * external HTTP request and cannot join a Postgres transaction):
 *   1. Validate --actor is a real bd row (before touching the admin API).
 *   2. Validate the service-role env vars are present.
 *   3. Call the admin API to set the ban.
 *   4. Read `banned_until` back and verify it is effectively permanent.
 *      If it is not, throw — loudly, so nobody believes a ban that is not there.
 *   5. Write ONE `audit_log` row (action `bd_access_revoked`) carrying the
 *      verified `banned_until`. If this fails, the ban is already in place —
 *      say so and exit 2, never 0.
 *
 * Exit codes:
 *   0 = access revoked AND the audit_log row was written (or already revoked)
 *   1 = nothing changed — bad arguments, unresolved target or actor, missing
 *       env vars, the admin API call failed, or the read-back said the ban
 *       did not take
 *   2 = access WAS revoked, but the audit_log insert failed afterward
 *
 * Usage:
 *   npx tsx --env-file=.env --env-file=.env.local scripts/revoke-bd-access.ts --email=<bd email>
 *   npx tsx --env-file=.env --env-file=.env.local scripts/revoke-bd-access.ts --email=<bd email> --execute --actor=<bd id>
 *
 * The dry run needs only DATABASE_URL (.env). `--execute` additionally needs
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local).
 * Never prints the connection string or the service-role key.
 */
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, bd } from "../src/db/schema";
import { BdAuthMatchError, type BdAuthMatch } from "../src/lib/auth/bdAuthMatch";
import { resolveBdAuthUser } from "../src/lib/auth/bdAuthResolveDb";
import {
  PERMANENT_BAN_DURATION,
  PERMANENT_BAN_YEARS,
  isEffectivelyPermanent,
} from "../src/lib/auth/accessRevocation";

export const REVOKE_AUDIT_ACTION = "bd_access_revoked";

type Args = { email?: string; execute: boolean; actor?: string };

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { execute: false };
  for (const arg of argv) {
    if (arg === "--execute") out.execute = true;
    else if (arg.startsWith("--email=")) out.email = arg.slice("--email=".length).trim();
    else if (arg.startsWith("--actor=")) out.actor = arg.slice("--actor=".length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

/** Reads the live `banned_until` for one auth user. Raw sql: `auth.users` is Supabase's schema, not ours. */
async function readBannedUntil(authUserId: string): Promise<Date | null> {
  const rows = await db.execute<{ banned_until: string | null }>(
    sql`select banned_until::text as banned_until from auth.users where id = ${authUserId}::uuid limit 1`,
  );
  const raw = [...rows][0]?.banned_until ?? null;
  return raw ? new Date(raw) : null;
}

async function executeRevoke(params: { actorBdId: string; target: BdAuthMatch }): Promise<{
  bannedUntil: Date;
  auditWritten: boolean;
  auditError?: string;
}> {
  const { actorBdId, target } = params;

  const [actor] = await db.select({ id: bd.id }).from(bd).where(eq(bd.id, actorBdId)).limit(1);
  if (!actor) throw new Error(`--actor=${actorBdId} does not match any bd row.`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It lives in .env.local — pass --env-file=.env --env-file=.env.local.",
    );
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin.auth.admin.updateUserById(target.authUser.id, {
    ban_duration: PERMANENT_BAN_DURATION,
  });
  if (error) throw new Error(`Supabase admin updateUserById failed: ${error.message}`);

  // Step 4: the API said yes. Now check the database agrees, because a ban
  // that silently expires is worse than no ban — it comes with a report that
  // says the person is locked out.
  const bannedUntil = await readBannedUntil(target.authUser.id);
  if (!isEffectivelyPermanent(bannedUntil, new Date())) {
    throw new Error(
      `The admin API reported success but auth.users.banned_until reads ${bannedUntil?.toISOString() ?? "NULL"}, ` +
        `which is not a permanent lockout. ACCESS IS NOT REVOKED. Check the Supabase project and retry.`,
    );
  }

  try {
    await db.insert(auditLog).values({
      actorBdId,
      action: REVOKE_AUDIT_ACTION,
      targetBdId: target.bd.id,
      metadata: {
        targetEmail: target.bd.email,
        targetName: target.bd.name,
        authUserId: target.authUser.id,
        bannedUntil: bannedUntil!.toISOString(),
        banDuration: PERMANENT_BAN_DURATION,
        lastSignInAt: target.authUser.lastSignInAt?.toISOString() ?? null,
        reversible: true,
        note:
          "Supabase Auth sign-in blocked via the admin API (banned_until), read back from auth.users and verified. " +
          "The bd row and everything referencing it were left untouched on purpose: deleting the bd row does not " +
          "block sign-in, because production re-provisions it on first visit (src/lib/auth/bdProvisioning.ts). " +
          "Reverse with ban_duration 'none'. Reassigning this BD's records and disconnecting their Gmail mailbox " +
          "(email_account) are separate decisions this did NOT make.",
      },
    });
    return { bannedUntil: bannedUntil!, auditWritten: true };
  } catch (err) {
    return {
      bannedUntil: bannedUntil!,
      auditWritten: false,
      auditError: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    throw new Error(
      "Usage: npx tsx --env-file=.env --env-file=.env.local scripts/revoke-bd-access.ts --email=<bd email> [--execute --actor=<bd id>]",
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
      // An account that is already banned or already deleted is the outcome
      // this script exists to produce — report it and stop, do not re-ban.
      if (err.reason === "auth_user_banned" || err.reason === "auth_user_deleted") {
        console.log(`Nothing to do — access for ${args.email} is already revoked.`);
        console.log(err.message);
        return;
      }
      console.error(`Cannot resolve target: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  console.log(`Target BD:      ${match.bd.name} <${match.bd.email}> (bd id ${match.bd.id}, role ${match.bd.role})`);
  console.log(`Auth user id:   ${match.authUser.id}`);
  console.log(`Last sign-in:   ${match.authUser.lastSignInAt ? match.authUser.lastSignInAt.toISOString() : "never"}`);
  console.log(`Banned until:   ${(await readBannedUntil(match.authUser.id))?.toISOString() ?? "not banned"}`);

  if (!args.execute) {
    console.log(
      `\nDry run only — would set auth.users.banned_until about ${PERMANENT_BAN_YEARS} years out ` +
        `(ban_duration ${PERMANENT_BAN_DURATION}) so this account can no longer sign in.`,
    );
    console.log("No bd row, contact, person, task or sequence would be touched. Reversible.");
    console.log("Re-run with --execute --actor=<bd id> to actually revoke access.");
    return;
  }

  console.log(`\nRevoking CRM access for ${match.bd.email} (actor bd id ${args.actor})...`);
  const result = await executeRevoke({ actorBdId: args.actor!, target: match });

  console.log(`\nAccess revoked. auth.users.banned_until = ${result.bannedUntil.toISOString()} (verified by read-back).`);
  if (!result.auditWritten) {
    console.error(
      `\nWARNING: access WAS revoked, but writing the audit_log row failed: ${result.auditError}. ` +
        "Record this manually.",
    );
    process.exitCode = 2;
    return;
  }
  console.log(`One audit_log row written (action: ${REVOKE_AUDIT_ACTION}).`);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
