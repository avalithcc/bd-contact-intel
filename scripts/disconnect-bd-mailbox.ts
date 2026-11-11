/**
 * Owner-operated MAILBOX DISCONNECT for a BD who left the company — the
 * offboarding companion to scripts/revoke-bd-access.ts.
 *
 * WHY THE APP'S OWN BUTTON IS NOT ENOUGH HERE: "Desconectar" on
 * /account/email (src/app/(app)/account/email/connectionActions.ts) is a SOFT
 * disconnect. It flips `email_account.status` to 'disconnected' and stamps
 * `disconnected_at`, and that is all. The encrypted refresh token stays in
 * the row, and Google's grant on the mailbox stays alive. That is the right
 * behaviour for a BD who will reconnect tomorrow. For someone who has left,
 * it leaves the CRM holding a live credential to a private mailbox — the
 * exact thing offboarding is supposed to end.
 *
 * WHAT THIS DOES, IN THIS ORDER, AND WHY THE ORDER IS THE WHOLE POINT:
 *   1. Validate --actor is a real bd row.
 *   2. Decrypt the stored refresh token.
 *   3. Revoke the grant at Google (https://oauth2.googleapis.com/revoke).
 *   4. ONLY if step 3 proves the grant is gone: clear
 *      `refresh_token_encrypted`, set status 'disconnected', stamp
 *      `disconnected_at`.
 *   5. Read the row back and verify the token column is really NULL.
 *   6. Write ONE `audit_log` row (`bd_mailbox_disconnected`).
 *
 * Step 4 must never run before step 3 succeeds. Clearing our copy first
 * would destroy the only thing capable of revoking the grant, leaving a LIVE
 * token on the person's mailbox that nobody can kill — while the script
 * prints "disconnected". src/lib/gmail/revokeGrant.ts carries the tested
 * classification that decides whether the grant is provably gone; a 500, a
 * rate limit or a network blip is NOT proof, and stops the run with nothing
 * changed so it can simply be re-run.
 *
 * WHEN THE TOKEN CANNOT BE DECRYPTED, STOP. This run REFUSES by default,
 * because "I cannot decrypt it" does NOT mean "it is dead" — and learning
 * that the hard way is why the rule exists. On 2026-11-11 this script cleared
 * a token it could not decrypt, on the assumption that an undecryptable token
 * was a rotated-key leftover and therefore useless to everyone. It was not:
 * the local GMAIL_TOKEN_ENCRYPTION_KEY simply differs from the one Vercel
 * runs in production, where that same token was syncing the mailbox minutes
 * earlier. Clearing it stopped the sync (the goal) but destroyed the only
 * copy capable of revoking the Google grant, turning a one-command job into a
 * manual cleanup in the mailbox owner's Google account.
 *
 * So: a decryption failure exits 1 and changes NOTHING. Re-run with the
 * production key (`GMAIL_TOKEN_ENCRYPTION_KEY` from the Vercel environment)
 * and the grant gets properly revoked. Only pass
 * `--force-clear-undecryptable` when you have decided that leaving a
 * dangling Google grant is acceptable and you want the column cleared
 * regardless; the audit row then records `googleGrantRevoked: false` and the
 * grant must be removed by hand from the mailbox owner's Google account under
 * "Third-party apps & services".
 *
 * STATUS VALUE: 'disconnected', deliberately, NOT 'revoked'. Those are not
 * synonyms in this codebase: src/lib/gmail/connectionBanner.ts reads
 * 'error'/'revoked' as "Google rejected the token, go reconnect" and shows a
 * red banner inviting exactly that. 'disconnected' is the deliberate,
 * BD-initiated shape, which is what an offboarding is.
 *
 * WHAT IT DOES NOT TOUCH: the `bd` row, the synced `email_message` history,
 * contacts, people, tasks, follow-ups. Mail already synced into the CRM is
 * company record and stays. Reassigning the departing BD's book of business
 * is a separate decision.
 *
 * NEVER PRINTS the refresh token, the encryption key or the connection
 * string, and never `select *` on `email_account` (README rule 3) — named
 * columns only.
 *
 * Exit codes:
 *   0 = mailbox disconnected AND the audit_log row was written (or already disconnected)
 *   1 = nothing changed — bad arguments, unresolved target/actor, missing env
 *       vars, the revocation was not proven, or the read-back failed
 *   2 = the mailbox WAS disconnected, but the audit_log insert failed afterward
 *
 * Usage:
 *   npx tsx --env-file=.env --env-file=.env.local scripts/disconnect-bd-mailbox.ts --email=<bd email>
 *   npx tsx --env-file=.env --env-file=.env.local scripts/disconnect-bd-mailbox.ts --email=<bd email> --execute --actor=<bd id>
 *
 * The dry run needs DATABASE_URL (.env) and reports up front whether the key
 * it has can decrypt the stored token — check that BEFORE running --execute.
 * `--execute` additionally needs GMAIL_TOKEN_ENCRYPTION_KEY, and it must be
 * PRODUCTION's key (the one in Vercel), not whatever sits in a local
 * .env.local: they are not the same, and only the right one can revoke the
 * Google grant.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, bd, emailAccount } from "../src/db/schema";
import { decryptToken } from "../src/lib/gmail/crypto";
import { classifyRevokeResponse, grantIsGone, type RevokeOutcome } from "../src/lib/gmail/revokeGrant";

export const MAILBOX_DISCONNECT_AUDIT_ACTION = "bd_mailbox_disconnected";

const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

type Args = { email?: string; execute: boolean; actor?: string; forceClearUndecryptable: boolean };

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { execute: false, forceClearUndecryptable: false };
  for (const arg of argv) {
    if (arg === "--execute") out.execute = true;
    else if (arg === "--force-clear-undecryptable") out.forceClearUndecryptable = true;
    else if (arg.startsWith("--email=")) out.email = arg.slice("--email=".length).trim();
    else if (arg.startsWith("--actor=")) out.actor = arg.slice("--actor=".length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

/** Named columns only — never `select *` here, the row holds the encrypted token. */
async function loadTarget(email: string) {
  const [row] = await db
    .select({
      bdId: bd.id,
      bdName: bd.name,
      bdEmail: bd.email,
      mailbox: emailAccount.emailAddress,
      status: emailAccount.status,
      hasToken: sql<boolean>`${emailAccount.refreshTokenEncrypted} is not null`,
      tokenEncrypted: emailAccount.refreshTokenEncrypted,
      connectedAt: emailAccount.connectedAt,
      disconnectedAt: emailAccount.disconnectedAt,
      lastSyncedAt: emailAccount.lastSyncedAt,
    })
    .from(bd)
    .leftJoin(emailAccount, eq(emailAccount.bdId, bd.id))
    .where(sql`lower(${bd.email}) = lower(${email})`)
    .limit(1);
  return row;
}

async function revokeAtGoogle(refreshToken: string): Promise<{ outcome: RevokeOutcome; detail: string }> {
  try {
    const res = await fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    const body = await res.text();
    return { outcome: classifyRevokeResponse(res.status, body), detail: `HTTP ${res.status}` };
  } catch (err) {
    // A thrown fetch proves nothing about the grant — treat it as retry.
    return { outcome: "retry", detail: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    throw new Error(
      "Usage: npx tsx --env-file=.env --env-file=.env.local scripts/disconnect-bd-mailbox.ts --email=<bd email> [--execute --actor=<bd id>]",
    );
  }
  if (args.execute && !args.actor) throw new Error("--execute requires --actor=<bd id> for the audit log");

  const target = await loadTarget(args.email);
  if (!target) {
    console.error(`No bd row found for ${args.email}.`);
    process.exitCode = 1;
    return;
  }
  if (!target.mailbox) {
    console.log(`${target.bdName} <${target.bdEmail}> has no email_account row — no mailbox is connected. Nothing to do.`);
    return;
  }

  console.log(`Target BD:      ${target.bdName} <${target.bdEmail}> (bd id ${target.bdId})`);
  console.log(`Mailbox:        ${target.mailbox}`);
  console.log(`Status:         ${target.status}`);
  console.log(`Refresh token:  ${target.hasToken ? "PRESENT (encrypted)" : "none stored"}`);
  console.log(`Connected at:   ${target.connectedAt?.toISOString() ?? "—"}`);
  console.log(`Last synced:    ${target.lastSyncedAt?.toISOString() ?? "never"}`);

  if (target.status !== "connected" && !target.hasToken) {
    console.log("\nAlready disconnected and no token stored. Nothing to do.");
    return;
  }

  if (!args.execute) {
    // Say NOW whether the Google grant can actually be revoked, rather than
    // letting the operator discover the wrong key halfway through a write.
    if (target.hasToken && target.tokenEncrypted) {
      try {
        decryptToken(target.tokenEncrypted);
        console.log("Token check:   decrypts with this key — the Google grant CAN be revoked.");
      } catch (err) {
        console.log(
          `Token check:   does NOT decrypt with this key (${err instanceof Error ? err.message : String(err)}).\n` +
            "               This key is not the one that encrypted it — almost certainly the local key rather than\n" +
            "               production's. Run --execute with the production GMAIL_TOKEN_ENCRYPTION_KEY, or the\n" +
            "               Google grant will survive and need removing by hand.",
        );
      }
    }
    console.log(
      "\nDry run only — would revoke the Google grant for this mailbox, then clear refresh_token_encrypted " +
        "and set status 'disconnected'.",
    );
    console.log("Synced mail, contacts, people, tasks and the bd row would NOT be touched.");
    console.log("Re-run with --execute --actor=<bd id> to actually disconnect.");
    return;
  }

  const [actor] = await db.select({ id: bd.id }).from(bd).where(eq(bd.id, args.actor!)).limit(1);
  if (!actor) throw new Error(`--actor=${args.actor} does not match any bd row.`);

  // Steps 2 + 3: prove the grant is dead BEFORE destroying our only copy of it.
  let googleGrantRevoked = false;
  let revokeNote = "no refresh token was stored, so there was nothing to revoke";
  if (target.hasToken && target.tokenEncrypted) {
    let plaintext: string | null = null;
    try {
      plaintext = decryptToken(target.tokenEncrypted);
    } catch (err) {
      revokeNote = `the stored token could not be decrypted (${err instanceof Error ? err.message : String(err)})`;
      if (!args.forceClearUndecryptable) {
        // Undecryptable is NOT evidence of a dead token — see the header.
        // The overwhelmingly likely cause is the wrong key for this
        // environment, and the token is alive and in use by production.
        console.error(
          `\nREFUSING: ${revokeNote}.\n` +
            "This almost always means the local GMAIL_TOKEN_ENCRYPTION_KEY is not the one production uses — the\n" +
            "token is probably LIVE and syncing right now. Nothing was changed. Re-run with the production key so\n" +
            "the Google grant is properly revoked.\n" +
            "If you have decided a dangling Google grant is acceptable, re-run with --force-clear-undecryptable.",
        );
        process.exitCode = 1;
        return;
      }
      console.error(
        `\nWARNING: ${revokeNote}, and --force-clear-undecryptable was passed. The column will be cleared, which\n` +
          "stops the sync, but the Google grant CANNOT be revoked from here. Remove it by hand from the mailbox\n" +
          "owner's Google account under \"Third-party apps & services\".",
      );
    }

    if (plaintext !== null) {
      const { outcome, detail } = await revokeAtGoogle(plaintext);
      if (!grantIsGone(outcome)) {
        console.error(
          `\nGoogle did not confirm the revocation (${detail}). NOTHING was changed — the stored token is intact ` +
            "so this can simply be run again. Clearing it now would leave a live grant nobody could revoke.",
        );
        process.exitCode = 1;
        return;
      }
      googleGrantRevoked = true;
      revokeNote = outcome === "revoked" ? `Google confirmed the revocation (${detail})` : `the grant was already invalid at Google (${detail})`;
      console.log(`\nGoogle grant: ${revokeNote}.`);
    }
  } else {
    console.log(`\nGoogle grant: ${revokeNote}.`);
  }

  // Step 4: only now.
  const now = new Date();
  await db
    .update(emailAccount)
    .set({ status: "disconnected", refreshTokenEncrypted: null, disconnectedAt: now, updatedAt: now })
    .where(eq(emailAccount.bdId, target.bdId));

  // Step 5: proof, not trust.
  const [after] = await db
    .select({ status: emailAccount.status, hasToken: sql<boolean>`${emailAccount.refreshTokenEncrypted} is not null` })
    .from(emailAccount)
    .where(eq(emailAccount.bdId, target.bdId))
    .limit(1);
  if (!after || after.hasToken || after.status !== "disconnected") {
    throw new Error(
      `Read-back failed: status=${after?.status ?? "missing"} tokenStillPresent=${after?.hasToken ?? "unknown"}. ` +
        "The mailbox may NOT be disconnected — investigate before reporting it as done.",
    );
  }
  console.log(`Row updated and verified: status=${after.status}, refresh_token_encrypted=NULL.`);

  try {
    await db.insert(auditLog).values({
      actorBdId: args.actor!,
      action: MAILBOX_DISCONNECT_AUDIT_ACTION,
      targetBdId: target.bdId,
      metadata: {
        targetEmail: target.bdEmail,
        targetName: target.bdName,
        mailbox: target.mailbox,
        previousStatus: target.status,
        tokenCleared: target.hasToken,
        googleGrantRevoked,
        revokeNote,
        note:
          "Offboarding disconnect: the Google grant was revoked and the stored refresh token cleared, which the " +
          "app's own Desconectar button does NOT do (it only flips status). Synced mail, contacts, people and " +
          "tasks were left untouched; reassigning them is a separate decision.",
      },
    });
  } catch (err) {
    console.error(
      `\nWARNING: the mailbox WAS disconnected, but writing the audit_log row failed: ` +
        `${err instanceof Error ? err.message : String(err)}. Record this manually.`,
    );
    process.exitCode = 2;
    return;
  }
  console.log(`One audit_log row written (action: ${MAILBOX_DISCONNECT_AUDIT_ACTION}).`);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
