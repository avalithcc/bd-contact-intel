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
 * MAX_CHANGES (a sanity cap: the measured problem is ~90 persons).
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
 *       plan exceeds MAX_CHANGES, or an unexpected error
 *
 * Usage (do NOT run --execute automatically: it writes the real database):
 *   npx tsx --env-file=.env.local scripts/backfill-owner-last-worked.ts
 *   npx tsx --env-file=.env.local scripts/backfill-owner-last-worked.ts --execute --actor=<bd id>
 *
 * Requires DATABASE_URL. Never prints the connection string.
 */
import { eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, bd, person, personBdConnection, personPropertyHistory } from "../src/db/schema";
import { countChangesWithMarker, planOwnerBackfill, type OwnerChange } from "../src/lib/identity/ownerBackfillPlan";
import { OWNER_BACKFILL_SOURCE, OWNER_HISTORY_PROPERTY } from "../src/lib/identity/ownerRule";
import { readImportOwnerPersonIds, readManualOwnerPersonIds, readOwnerTouches } from "../src/lib/identity/ownerRuleDb";
import { chunk, WRITE_BATCH_SIZE } from "../src/lib/migration/collapseWriteRows";

const MAX_CHANGES = 2000;
const AUDIT_ACTION = "backfill_owner_last_worked";

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

  // Four set-based reads, no per-row queries.
  const [persons, connections, touches, manualPersonIds, importOwnerPersonIds] = await Promise.all([
    db.select({ id: person.id, ownerBdId: person.ownerBdId }).from(person).where(isNull(person.mergedIntoId)),
    db
      .select({
        personId: personBdConnection.personId,
        bdId: personBdConnection.bdId,
        connectedOn: personBdConnection.connectedOn,
        lastMessageAt: personBdConnection.lastMessageAt,
      })
      .from(personBdConnection),
    readOwnerTouches(db),
    readManualOwnerPersonIds(db),
    readImportOwnerPersonIds(db),
  ]);

  const plan = planOwnerBackfill({ persons, connections, touches, manualPersonIds });
  const byBasis = (basis: OwnerChange["basis"]) => plan.changes.filter((c) => c.basis === basis).length;

  console.log(`Live persons: ${persons.length}`);
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
  if (!plan.changes.length) {
    console.log("Nothing to update.");
    return;
  }
  if (plan.changes.length > MAX_CHANGES) {
    console.error(`Refusing: ${plan.changes.length} changes exceeds the safety cap of ${MAX_CHANGES}. Review the dry run first.`);
    process.exitCode = 1;
    return;
  }
  const [actorRow] = await db.select({ id: bd.id }).from(bd).where(eq(bd.id, actor!)).limit(1);
  if (!actorRow) {
    console.error(`Refusing: --actor=${actor} does not match any bd row.`);
    process.exitCode = 1;
    return;
  }

  const applied = await db.transaction(async (tx) => {
    const appliedChanges: OwnerChange[] = [];
    for (const batch of chunk(plan.changes, WRITE_BATCH_SIZE)) {
      const values = batch.map((c) => sql`(${c.personId}::uuid, ${c.fromBdId}::uuid, ${c.toBdId}::uuid)`);
      const updated = (await tx.execute(sql`
        UPDATE person AS p SET owner_bd_id = v.new_owner
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, old_owner, new_owner)
        WHERE p.id = v.id AND p.owner_bd_id IS NOT DISTINCT FROM v.old_owner
        RETURNING p.id::text AS id
      `)) as unknown as { id: string }[];
      const updatedIds = new Set(updated.map((r) => r.id));
      const done = batch.filter((c) => updatedIds.has(c.personId));
      if (done.length) {
        await tx.insert(personPropertyHistory).values(
          done.map((c) => ({
            personId: c.personId,
            property: OWNER_HISTORY_PROPERTY,
            oldValue: c.fromBdId,
            newValue: c.toBdId,
            changedByBdId: actorRow.id,
            source: OWNER_BACKFILL_SOURCE,
          })),
        );
      }
      appliedChanges.push(...done);
    }
    await tx.insert(auditLog).values({
      actorBdId: actorRow.id,
      action: AUDIT_ACTION,
      metadata: {
        planned: plan.changes.length,
        updated: appliedChanges.length,
        changedSinceRead: plan.changes.length - appliedChanges.length,
        byLastTouch: appliedChanges.filter((c) => c.basis === "last_touch").length,
        byEarliestConnection: appliedChanges.filter((c) => c.basis === "earliest_connection").length,
        unchanged: plan.unchanged,
        skippedManual: plan.skippedManual,
        historySource: OWNER_BACKFILL_SOURCE,
      },
    });
    return appliedChanges.length;
  });

  console.log(`Updated ${applied} persons (${plan.changes.length - applied} changed since the read and were left alone).`);
  console.log(`audit_log row written (action ${AUDIT_ACTION}).`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
