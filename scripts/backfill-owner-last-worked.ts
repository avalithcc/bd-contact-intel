/**
 * Recomputes `person.owner_bd_id` for every live person under the
 * "owner = whoever worked the contact LAST" rule (src/lib/identity/ownerRule.ts).
 *
 * Why this exists: ownership used to follow R3 (earliest LinkedIn
 * `connected_on` wins) and manual reassignment was blocked for anyone with a
 * `person_bd_connection` row. 90 live persons ended up owned by a BD who never
 * wrote to them while another BD did, and no UI path could fix them. The rule
 * is now last-worked (latest of `person_bd_connection.last_message_at` and the
 * BD's latest activity on the person; connection seniority only breaks ties
 * and is the fallback when nobody touched the contact). This script applies
 * the new rule to the existing base.
 *
 * What it does: reads every live person, their connections, per-(person, BD)
 * latest activity (effective time, src/lib/contacts/effectiveActivityTime.ts)
 * and the persons whose owner was set by hand, runs the pure planner
 * (src/lib/identity/ownerBackfillPlan.ts), and reports:
 *   - would change   (split by basis: last_touch / earliest_connection)
 *   - unchanged      (already right, or nothing to decide on: owner is kept)
 *   - skipped manual (a `person_property_history` row with property
 *                     `ownerBdId` and source `edit` makes the owner sticky)
 *
 * History source choice: each change writes a `person_property_history` row
 * with source `owner_backfill`, deliberately NOT `edit`. `edit` is the marker
 * of a manual assignment, so using it here would make every backfilled owner
 * permanently sticky and defeat the rule this script applies. The row keeps
 * old_value, which is what makes the change revertible.
 *
 * The dry run also splits the planned changes by whether the person has a
 * prior `ownerBdId` history row with source `import` (counts only): import
 * ownership is not sticky, and the DFF import wrote it as a deliberate owner
 * reconfirmation, so a non-zero count needs a decision before --execute.
 *
 * Defaults to a DRY RUN that prints counts only, never row-level data.
 * `--execute --actor=<bd id>` writes the `person.owner_bd_id` updates, one
 * history row per change and ONE `audit_log` row (action
 * `backfill_owner_last_worked`) in a single transaction, batched. Each update
 * is guarded by the owner the plan read (`owner_bd_id IS NOT DISTINCT FROM
 * old`), so a person re-assigned between the read and the write is left alone
 * and counted as "changed since read". Refuses to run when the plan exceeds
 * OWNER_SCRIPT_MAX_CHANGES (2000, ownerBackfillGuards.ts).
 *
 * The nightly cron (src/app/api/owners/recompute/route.ts) runs the SAME
 * shared code (ownerBackfillRun.ts) with a much tighter cap and `trigger: cron`
 * in the audit row; this script writes `trigger: manual`. Run this one-shot
 * `--execute` BEFORE trusting the cron: it applies the initial cleanup.
 *
 * Irreversible: nothing is deleted, but the previous owners are only
 * recoverable through the history rows. Revert path (restores the previous
 * owner wherever it still holds the backfilled value), in one transaction:
 *   UPDATE person p SET owner_bd_id = h.old_value::uuid
 *   FROM person_property_history h
 *   WHERE h.person_id = p.id AND h.property = 'ownerBdId'
 *     AND h.source = 'owner_backfill' AND p.owner_bd_id = h.new_value::uuid;
 * followed by deleting those history rows and writing a matching audit row.
 *
 * Exit codes:
 *   0 = clean dry run, or the update, history and audit rows were written
 *   1 = nothing was written: bad arguments, actor is not a real bd row, the
 *       plan exceeds the cap, or an unexpected error
 *
 * Usage (do NOT run --execute automatically: it writes the real database):
 *   npx tsx --env-file=.env.local scripts/backfill-owner-last-worked.ts
 *   npx tsx --env-file=.env.local scripts/backfill-owner-last-worked.ts --execute --actor=<bd id>
 *
 * Requires DATABASE_URL. Never prints the connection string.
 */
import { db } from "../src/db";
import { countChangesWithMarker, type OwnerChange } from "../src/lib/identity/ownerBackfillPlan";
import { decideOwnerBackfillRun, OWNER_SCRIPT_MAX_CHANGES } from "../src/lib/identity/ownerBackfillGuards";
import { applyOwnerBackfill, bdExists, loadOwnerBackfill, OWNER_BACKFILL_AUDIT_ACTION } from "../src/lib/identity/ownerBackfillRun";

function parseArgs(argv: readonly string[]): { execute: boolean; actor: string | null } {
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false; // explicit no-op, dry-run is already the default
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --execute, --actor=<bd id>`);
  }
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log");
  return { execute, actor };
}

async function main() {
  const { execute, actor } = parseArgs(process.argv.slice(2));

  const { livePersons, plan, importOwnerPersonIds } = await loadOwnerBackfill(db);
  const byBasis = (basis: OwnerChange["basis"]) => plan.changes.filter((c) => c.basis === basis).length;

  console.log(`Live persons: ${livePersons}`);
  console.log(`Would change: ${plan.changes.length}`);
  console.log(`  by last touch: ${byBasis("last_touch")}`);
  console.log(`  by earliest connection (nobody touched it): ${byBasis("earliest_connection")}`);
  // `import` ownership is NOT sticky, but the DFF import wrote it as a deliberate
  // owner reconfirmation: a non-zero count here needs an owner decision before --execute.
  const byImport = countChangesWithMarker(plan.changes, importOwnerPersonIds);
  console.log(`  of which the person has a prior ownerBdId history row with source 'import': ${byImport.marked}`);
  console.log(`  of which no such row: ${byImport.unmarked}`);
  console.log(`Unchanged: ${plan.unchanged}`);
  console.log(`Skipped, owner set manually: ${plan.skippedManual}`);

  if (!execute) {
    console.log("Dry run only — nothing was written. Re-run with --execute --actor=<bd id>.");
    return;
  }
  const decision = decideOwnerBackfillRun(plan, OWNER_SCRIPT_MAX_CHANGES);
  if (decision === "nothing_to_do") {
    console.log("Nothing to update.");
    return;
  }
  if (decision === "over_cap") {
    console.error(`Refusing: ${plan.changes.length} changes exceeds the safety cap of ${OWNER_SCRIPT_MAX_CHANGES}. Review the dry run first.`);
    process.exitCode = 1;
    return;
  }
  if (!(await bdExists(db, actor!))) {
    console.error(`Refusing: --actor=${actor} does not match any bd row.`);
    process.exitCode = 1;
    return;
  }

  const { applied } = await applyOwnerBackfill(db, plan, actor!, "manual");
  console.log(`Updated ${applied} persons (${plan.changes.length - applied} changed since the read and were left alone).`);
  console.log(`audit_log row written (action ${OWNER_BACKFILL_AUDIT_ACTION}, trigger manual).`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
