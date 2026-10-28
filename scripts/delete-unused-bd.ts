/**
 * Owner-run removal of a `bd` account that nothing in the database uses — the counterpart of
 * scripts/create-bd.ts. Written to retire the `ZZ E2E (no asignar)` test account (2026-10-28), which the e2e
 * suite stopped needing when it was guarded against production: scripts/create-e2e-auth-user.ts now refuses
 * any Supabase URL that is not loopback, and the specs upsert their own `bd` rows in the scratch database.
 *
 * TWO OBJECTS, IN THIS ORDER. The Supabase Auth user goes FIRST, the `bd` row second. The other way round
 * leaves a window in which a sign-in with that account makes `getCurrentBd` (src/lib/queries.ts) insert a
 * fresh `bd` row, and the account is back.
 *
 * THE GATE. It refuses unless the footprint sweep (src/lib/bd/bdFootprint.ts, the same one
 * scripts/measure/bd-footprint.ts reports) finds no BLOCKING reference: rows exist only in columns whose
 * foreign key is `on delete set null`, which survive the delete with a null pointer. A reference through an
 * `on delete cascade` column — audit rows where this BD was the actor, its connections — blocks, because
 * deleting the bd would take that history with it. So this script cannot remove a BD who did any work; for
 * one who did, the answer is not deletion. The sweep runs TWICE: once to report, and again inside the
 * deleting transaction after `select … for update`, because the first sweep is only a snapshot and rows can
 * arrive in the seconds the dump and the Auth call take.
 *
 * NOT FULLY REVERSIBLE. The pre-delete dump covers `bd`, `audit_log` and every table the sweep found a
 * surviving reference in, so the row, its audit trail and the pointers this delete nulls can be restored.
 * But `pg_dump` of the public schema does NOT contain Supabase's `auth` schema: the Auth user cannot be
 * restored from it. Bringing the account back means inviting it again.
 *
 * IF IT FAILS AFTER THE AUTH DELETE, production is left with a `bd` row that has no login. Nobody can sign
 * in as it, so nothing is exposed, but a rerun will not fix it: `resolveBdAuthUser` refuses an account whose
 * Auth user is gone. The catch below prints the exact recovery.
 *
 * Dry run is the default and writes nothing. Usage:
 *   npx tsx --env-file=.env.local scripts/delete-unused-bd.ts --email=<bd email>
 *   npx tsx --env-file=.env.local scripts/delete-unused-bd.ts --email=<bd email> --execute --actor=<bd id>
 *
 * `--execute` needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (owner-run scripts only; the key
 * is never read from `src/`). Prints no key and no password.
 *
 * EXIT CODES: 0 success (dry run or delete); 1 bad arguments, a blocking reference, or any failure
 * (the message says whether anything was written).
 */
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, bd } from "../src/db/schema";
import { blockingReferences, readBdFootprint, type BdReference } from "../src/lib/bd/bdFootprint";
import { resolveBdAuthUser } from "../src/lib/auth/bdAuthResolveDb";
import { snapshotBackup } from "../src/lib/migration/backup";

/**
 * A floor on how many foreign keys to `bd(id)` the sweep must find. 46 on 2026-10-28; the number only grows
 * as tables are added. It guards the one failure the sweep cannot see by itself: if the connecting role ever
 * loses visibility of the catalog, the sweep returns few or no rows and everything looks deletable.
 */
const MIN_EXPECTED_BD_FKS = 40;

function parseArgs(argv: readonly string[]) {
  let email: string | null = null;
  let actor: string | null = null;
  let execute = false;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--email=")) email = arg.slice("--email=".length);
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --email=<bd email>, --execute, --actor=<bd id>`);
  }
  if (!email) throw new Error("Usage: --email=<bd email> [--execute --actor=<bd id>]");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return { email, actor, execute };
}

function report(references: readonly BdReference[]): { blocking: BdReference[]; kept: BdReference[] } {
  const blocking = blockingReferences(references);
  const kept = references.filter((r) => r.rows > 0 && !blocking.includes(r));
  return { blocking, kept };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const target = await resolveBdAuthUser(options.email);
  console.log(`bd:   ${target.bd.name} <${target.bd.email}> id=${target.bd.id} role=${target.bd.role ?? "-"}`);
  console.log(`auth: ${target.authUser.id} | último login ${target.authUser.lastSignInAt?.toISOString() ?? "nunca"}`);

  const references = await readBdFootprint(db, target.bd.id);
  if (references.length < MIN_EXPECTED_BD_FKS) {
    throw new Error(
      `refusing: the sweep found only ${references.length} foreign keys to bd(id), fewer than the ${MIN_EXPECTED_BD_FKS} expected. ` +
        "The catalog is not fully visible to this role, so an empty footprint would be meaningless.",
    );
  }
  const { blocking, kept } = report(references);
  console.log(`\nswept ${references.length} foreign keys to bd(id).`);
  for (const r of kept) console.log(`  survives with a null pointer: ${r.table}.${r.column} (${r.rows} row(s), on delete ${r.deleteRule.toLowerCase()})`);
  if (blocking.length > 0) {
    for (const r of blocking) console.log(`  BLOCKING: ${r.table}.${r.column} (${r.rows} row(s), on delete ${r.deleteRule.toLowerCase()})`);
    throw new Error("refusing: this BD is referenced by rows that a delete would destroy or that would block it.");
  }
  console.log("  no blocking reference.");

  if (!options.execute) {
    console.log("\nDRY RUN. Nothing written. --execute would, in order: dump bd + audit_log + the tables above, delete the Supabase Auth user, then, in ONE transaction, re-check the sweep, write one audit_log row and delete the bd row.");
    process.exit(0);
  }

  const [actorRow] = await db.select({ id: bd.id }).from(bd).where(eq(bd.id, options.actor!)).limit(1);
  if (!actorRow) throw new Error(`--actor=${options.actor} does not match any bd row.`);
  // The audit row hangs off the actor through an ON DELETE CASCADE, so an actor who is also the target would
  // have the only record of this deletion cascaded away by the deletion itself.
  if (actorRow.id === target.bd.id) throw new Error("--actor cannot be the BD being deleted: the audit row would be cascaded away with it.");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (owner-run scripts only — never prefix it NEXT_PUBLIC_).");

  // Dump the tables whose pointers this delete nulls, not just bd/audit_log: without them a restore could
  // not say which rows used to point at this BD.
  const backupTables = [...new Set(["bd", "audit_log", ...kept.map((r) => r.table.replace(/^public\./, "").replace(/"/g, ""))])];
  console.log(`\nbackup: ${await snapshotBackup("delete-unused-bd", backupTables, { requiredTables: backupTables })}`);

  // Auth first: see the header. A failure here has written nothing.
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.auth.admin.deleteUser(target.authUser.id);
  if (error) throw new Error(`Supabase admin deleteUser failed (nothing written): ${error.message}`);
  console.log(`deleted auth user ${target.authUser.id}`);

  try {
    await db.transaction(async (tx) => {
      // Lock the row, THEN re-ask the question: the sweep above is a snapshot from before the dump and the
      // Auth call, and a row inserted since would be cascaded away silently by the delete below.
      await tx.execute(sql`select 1 from bd where id = ${target.bd.id}::uuid for update`);
      const again = blockingReferences(await readBdFootprint(tx, target.bd.id));
      if (again.length > 0) {
        throw new Error(
          `a reference appeared while this script was running: ${again.map((r) => `${r.table}.${r.column} (${r.rows})`).join(", ")}. Nothing was deleted in the database.`,
        );
      }
      // Written BEFORE the delete: audit_log.actor_bd_id is ON DELETE CASCADE, and target_bd_id would be
      // nulled by this very delete, so the target's identity lives in metadata.
      await tx.insert(auditLog).values({
        actorBdId: options.actor!,
        action: "bd_deleted",
        metadata: {
          deletedBdId: target.bd.id,
          deletedEmail: target.bd.email,
          deletedName: target.bd.name,
          deletedAuthUserId: target.authUser.id,
          nulledReferences: kept.map((r) => ({ table: r.table, column: r.column, rows: r.rows })),
        },
      });
      await tx.execute(sql`delete from bd where id = ${target.bd.id}::uuid`);
    });
  } catch (err) {
    console.error(
      `\nThe Auth user ${target.authUser.id} IS ALREADY DELETED, and the transaction that removes the bd row failed:\n` +
        `  ${err instanceof Error ? err.message : String(err)}\n` +
        `Production now holds bd ${target.bd.id} <${target.bd.email}> with no login. Nobody can sign in as it.\n` +
        "A rerun will NOT fix it (resolveBdAuthUser refuses an account whose Auth user is gone). Recover by\n" +
        "resolving whatever the message above reports and then deleting that one row by hand, or by restoring\n" +
        "the dump printed above. The Auth user itself is not in that dump and would need a fresh invite.",
    );
    process.exit(1);
  }

  console.log("deleted bd row");
  console.log("done. The Auth user is NOT restorable from the dump — bringing this account back means a new invite.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
