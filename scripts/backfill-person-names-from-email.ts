/**
 * One-off, owner-gated backfill: fills EMPTY `person.first_name`/
 * `person.last_name` from the verified email's local part (e.g.
 * `efrain.romero@storicard.com` -> "Efrain" / "Romero"), for non-merged
 * persons whose first AND last name are BOTH empty. Refuses rather than
 * guesses — see src/lib/identity/nameFromEmailBackfill.ts for the exact
 * rule, every skip reason (including `owner_excluded`, the 6 owner-reviewed
 * functional mailboxes that pass the structural rule but aren't a person),
 * and every skip reason.
 *
 * Deliberately does NOT touch persons that have a first name but no last
 * name (a separate, out-of-scope problem — some of those have the full name
 * stuffed into first_name, and guessing a last name from the email there
 * would corrupt it, e.g. "Colette Harington" + "harrington@..." ->
 * "Colette Harington Harrington").
 *
 * Collision measurement + queueing (read-only measurement every run; the
 * queue insert only happens on `--execute`): for every planned fill, checks
 * whether applying it would make the person share `buildNameCompanyKey`
 * (src/lib/identity/matcher.ts — the SAME key the live identity matcher's
 * name+company review rule uses) with an ALREADY EXISTING, non-merged
 * person. A collision here does not block the fill — a name+company match
 * NEVER auto-merges (see matcher.ts's "review" case, never "auto"). Instead,
 * each colliding pair is queued into the EXISTING `duplicate_candidate`
 * mechanism (same table, same reason `name_company`, same pair ordering
 * live ingestion already uses — see src/lib/identity/resolveDb.ts), so it
 * shows up in `/admin/duplicates` for a human to review — never a
 * pair that already exists for that exact (personA, personB), in ANY status
 * (open/merged/not_duplicate): see filterAlreadyQueuedDuplicateCandidates.
 *
 * `--execute` hardening (same shape as scripts/backfill-company-domains.ts):
 *   1. All or nothing — the batched name UPDATE, the batched
 *      `duplicate_candidate` INSERT, and the `audit_log` INSERT all run
 *      inside ONE `db.transaction`. The name UPDATE is one bulk
 *      `UPDATE ... FROM (VALUES ...)` statement (src/lib/roleGroups.ts-style
 *      batching, see scripts/backfill-role-groups.ts), never one round trip
 *      per row.
 *   2. Audit trail — one `audit_log` row (action
 *      `person_name_from_email_backfill`) in the same transaction. Metadata
 *      (src/lib/identity/nameFromEmailBackfillAudit.ts) carries each
 *      applied fill's personId + the exact firstName/lastName written (the
 *      revert path needs the written value, not just the id — see below),
 *      plus the id of every `duplicate_candidate` row this run inserted.
 *   3. Re-check before writing — the UPDATE's WHERE clause re-checks BOTH
 *      first_name and last_name are still empty at write time, on top of the
 *      in-memory snapshot check the read already did. A row that changed
 *      since the dry run is skipped, not overwritten, and reported as
 *      `fillsSkippedRace` (audit metadata), never silently dropped. The
 *      `duplicate_candidate` insert also keeps `onConflictDoNothing` on the
 *      pair-unique constraint as a second line of defense.
 *
 * Revert: `--revert` (dry run) or `--revert --execute --actor=<bd id>`
 * (applies). Reads the most recent matching audit_log row and only reverts
 * a person whose CURRENT name still equals exactly what this run wrote (a
 * BD's later correction is never silently wiped), and only deletes a
 * queued `duplicate_candidate` row that is still `open` (an already-
 * reviewed pair is left alone and reported) — see
 * src/lib/identity/nameFromEmailBackfillRevert.ts for the exact selection
 * rule. The revert's own writes re-check both conditions again at write
 * time (same "re-check before writing" rule as the forward path), in one
 * transaction, with a new `audit_log` row (action
 * `person_name_from_email_backfill_revert`).
 *
 * Defaults to `--dry-run` (no writes) and REQUIRES `--execute --actor=<bd
 * id>` to actually write. Requires DATABASE_URL to be set (see .env).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-person-names-from-email.ts                          # dry run (default)
 *   npx tsx --env-file=.env.local scripts/backfill-person-names-from-email.ts --execute --actor=<bd id> # writes
 *   npx tsx --env-file=.env.local scripts/backfill-person-names-from-email.ts --revert                  # revert dry run
 *   npx tsx --env-file=.env.local scripts/backfill-person-names-from-email.ts --revert --execute --actor=<bd id>
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, duplicateCandidate } from "../src/db/schema";
import {
  buildNameFromEmailPlan,
  filterAlreadyQueuedDuplicateCandidates,
  findNameCompanyCollisions,
  planDuplicateCandidateQueue,
  type NameFromEmailSkipReason,
} from "../src/lib/identity/nameFromEmailBackfill";
import { buildNameFromEmailBackfillAuditMetadata } from "../src/lib/identity/nameFromEmailBackfillAudit";
import {
  readCollisionCandidates,
  readExistingDuplicateCandidatePairs,
  readNameFromEmailBackfillCandidates,
} from "../src/lib/identity/nameFromEmailBackfillDb";
import { buildNameFromEmailRevertPlan } from "../src/lib/identity/nameFromEmailBackfillRevert";
import {
  readCurrentDuplicateCandidatesByIds,
  readCurrentPersonsByIds,
  readLatestNameFromEmailBackfillAudit,
  REVERT_ACTION,
} from "../src/lib/identity/nameFromEmailBackfillRevertDb";

interface Args {
  execute: boolean;
  actor: string | null;
  revert: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let execute = false;
  let actor: string | null = null;
  let revert = false;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false; // explicit no-op, dry-run is already the default
    else if (arg === "--revert") revert = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --execute, --dry-run, --revert, --actor=<bd id>`);
  }
  return { execute, actor, revert };
}

const SKIP_REASON_ORDER: NameFromEmailSkipReason[] = [
  "single_token",
  "too_many_tokens",
  "short_token",
  "non_letter_token",
  "generic_word",
  "owner_excluded",
  "malformed",
];

async function runForwardBackfill(args: Args) {
  const candidates = await readNameFromEmailBackfillCandidates();
  const plan = buildNameFromEmailPlan(candidates);

  console.log(`Candidates read (non-merged, both names empty, has email): ${candidates.length}`);
  console.log(`Fills found: ${plan.fills.length}`);
  console.log(`Skips found: ${plan.skips.length}`);
  console.log("Skip totals by reason:");
  const skipsByReason = new Map<NameFromEmailSkipReason, typeof plan.skips>();
  for (const skip of plan.skips) {
    const list = skipsByReason.get(skip.reason) ?? [];
    list.push(skip);
    skipsByReason.set(skip.reason, list);
  }
  for (const reason of SKIP_REASON_ORDER) {
    const list = skipsByReason.get(reason) ?? [];
    if (list.length === 0) continue;
    console.log(`  ${reason}: ${list.length}`);
  }

  const companyKeys = [...new Set(plan.fills.map((f) => f.companyKey).filter((k): k is string => k !== null))];
  const collisionCandidates = await readCollisionCandidates(companyKeys);
  const collisions = findNameCompanyCollisions(plan.fills, collisionCandidates);
  const queueCandidates = planDuplicateCandidateQueue(collisions);
  const existingPairs = await readExistingDuplicateCandidatePairs(queueCandidates);
  const queuePlan = filterAlreadyQueuedDuplicateCandidates(queueCandidates, existingPairs);

  console.log("");
  console.log(
    `Name+company collisions (this fill would newly match buildNameCompanyKey against an EXISTING person): ${collisions.length}`,
  );
  for (const collision of collisions) {
    console.log(
      `  ${collision.email} -> ${collision.firstName} ${collision.lastName} @ ${collision.companyKey} ` +
        `collides with person id(s): ${collision.collidesWithPersonIds.join(", ")}`,
    );
  }

  console.log("");
  console.log(
    `duplicate_candidate pairs to queue for /admin/duplicates review (reason=name_company): ${queuePlan.toQueue.length}`,
  );
  for (const pair of queuePlan.toQueue) {
    console.log(`  ${pair.personAId} <-> ${pair.personBId} (matchKey=${pair.matchKey})`);
  }
  if (queuePlan.alreadyQueued.length) {
    console.log(`Pairs already existing (any status), NOT re-queued: ${queuePlan.alreadyQueued.length}`);
    for (const pair of queuePlan.alreadyQueued) {
      console.log(`  ${pair.personAId} <-> ${pair.personBId} (existing status=${pair.existingStatus})`);
    }
  }

  console.log("");
  console.log(`Every proposed fill (${plan.fills.length}):`);
  for (const fill of plan.fills) {
    console.log(`  ${fill.email} -> ${fill.firstName} ${fill.lastName}`);
  }

  console.log("");
  console.log("Sample of skips per reason (up to 10 each):");
  for (const reason of SKIP_REASON_ORDER) {
    const list = skipsByReason.get(reason) ?? [];
    if (list.length === 0) continue;
    console.log(`  ${reason}:`);
    for (const skip of list.slice(0, 10)) {
      console.log(`    ${skip.email}`);
    }
  }

  if (!args.execute) {
    console.log("");
    console.log("Dry run only — no writes performed. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  const appliedFills: { personId: string; firstName: string; lastName: string }[] = [];
  const skippedRacePersonIds: string[] = [];
  const queuedDuplicateCandidates: { id: string; personAId: string; personBId: string }[] = [];

  await db.transaction(async (tx) => {
    if (plan.fills.length > 0) {
      const values = plan.fills.map(
        (fill) => sql`(${fill.personId}::uuid, ${fill.firstName}::text, ${fill.lastName}::text)`,
      );
      const updatedRows = (await tx.execute(sql`
        UPDATE person AS p
        SET first_name = v.first_name,
            last_name = v.last_name,
            updated_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, first_name, last_name)
        WHERE p.id = v.id
          AND (p.first_name IS NULL OR btrim(p.first_name) = '')
          AND (p.last_name IS NULL OR btrim(p.last_name) = '')
        RETURNING p.id
      `)) as unknown as { id: string }[];

      const updatedIds = new Set(updatedRows.map((r) => r.id));
      for (const fill of plan.fills) {
        if (updatedIds.has(fill.personId)) {
          appliedFills.push({ personId: fill.personId, firstName: fill.firstName, lastName: fill.lastName });
        } else {
          skippedRacePersonIds.push(fill.personId);
        }
      }
    }

    if (queuePlan.toQueue.length > 0) {
      const inserted = await tx
        .insert(duplicateCandidate)
        .values(
          queuePlan.toQueue.map((pair) => ({
            personAId: pair.personAId,
            personBId: pair.personBId,
            reason: pair.reason,
            matchKey: pair.matchKey,
          })),
        )
        .onConflictDoNothing({ target: [duplicateCandidate.personAId, duplicateCandidate.personBId] })
        .returning({ id: duplicateCandidate.id, personAId: duplicateCandidate.personAId, personBId: duplicateCandidate.personBId });
      queuedDuplicateCandidates.push(...inserted);
    }

    const metadata = buildNameFromEmailBackfillAuditMetadata({
      fillsPlanned: plan.fills.length,
      appliedFills,
      skippedRacePersonIds,
      queuedDuplicateCandidates,
      alreadyQueuedDuplicateCandidatesCount: queuePlan.alreadyQueued.length,
    });
    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: "person_name_from_email_backfill",
      metadata,
    });
  });

  console.log("");
  console.log(`Applied ${appliedFills.length} name fill(s).`);
  console.log(`Queued ${queuedDuplicateCandidates.length} duplicate_candidate row(s).`);
  if (skippedRacePersonIds.length) {
    console.log(
      `${skippedRacePersonIds.length} planned fill(s) were skipped — the person's name was no longer empty at ` +
        "write time (see audit_log for the exact set).",
    );
  }
  if (appliedFills.length !== plan.fills.length) {
    console.log(
      `Applied (${appliedFills.length}) does not equal planned (${plan.fills.length}) — ` +
        `fully explained by the ${skippedRacePersonIds.length} skipped above.`,
    );
  }
}

async function runRevert(args: Args) {
  const audit = await readLatestNameFromEmailBackfillAudit();
  if (!audit) {
    console.log("No person_name_from_email_backfill audit_log row found — nothing to revert.");
    return;
  }
  console.log(`Reverting audit_log row ${audit.id}: ${audit.fills.length} fill(s), ${audit.duplicateCandidatesQueued.length} queued duplicate_candidate(s).`);

  const [currentPersons, currentDuplicateCandidates] = await Promise.all([
    readCurrentPersonsByIds(audit.fills.map((f) => f.personId)),
    readCurrentDuplicateCandidatesByIds(audit.duplicateCandidatesQueued.map((d) => d.id)),
  ]);

  const plan = buildNameFromEmailRevertPlan({
    auditedFills: audit.fills,
    currentPersons,
    auditedDuplicateCandidates: audit.duplicateCandidatesQueued,
    currentDuplicateCandidates,
  });

  const fillByPersonId = new Map(audit.fills.map((f) => [f.personId, f] as const));
  console.log("");
  console.log(`Persons to revert to empty name (${plan.personIdsToRevert.length}):`);
  for (const personId of plan.personIdsToRevert) {
    const fill = fillByPersonId.get(personId)!;
    console.log(`  ${personId} (currently ${fill.firstName} ${fill.lastName})`);
  }
  if (plan.personsSkipped.length) {
    console.log(`Persons skipped (${plan.personsSkipped.length}):`);
    for (const skip of plan.personsSkipped) {
      console.log(`  ${skip.personId}: ${skip.reason}`);
    }
  }

  console.log("");
  console.log(`duplicate_candidate rows to delete (${plan.duplicateCandidateIdsToDelete.length}):`);
  for (const id of plan.duplicateCandidateIdsToDelete) console.log(`  ${id}`);
  if (plan.duplicateCandidatesSkipped.length) {
    console.log(`duplicate_candidate rows left alone (already reviewed or not found) (${plan.duplicateCandidatesSkipped.length}):`);
    for (const skip of plan.duplicateCandidatesSkipped) console.log(`  ${skip.id}: ${skip.reason}`);
  }

  if (!args.execute) {
    console.log("");
    console.log("Revert dry run only — no writes performed. Re-run with --revert --execute --actor=<bd id> to apply.");
    return;
  }

  let revertedPersonIds: string[] = [];
  let deletedDuplicateCandidateIds: string[] = [];

  await db.transaction(async (tx) => {
    if (plan.personIdsToRevert.length > 0) {
      const values = plan.personIdsToRevert.map((id) => {
        const fill = fillByPersonId.get(id)!;
        return sql`(${id}::uuid, ${fill.firstName}::text, ${fill.lastName}::text)`;
      });
      const revertedRows = (await tx.execute(sql`
        UPDATE person AS p
        SET first_name = NULL,
            last_name = NULL,
            updated_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, first_name, last_name)
        WHERE p.id = v.id
          AND p.first_name = v.first_name
          AND p.last_name = v.last_name
        RETURNING p.id
      `)) as unknown as { id: string }[];
      revertedPersonIds = revertedRows.map((r) => r.id);
    }

    if (plan.duplicateCandidateIdsToDelete.length > 0) {
      const deletedRows = await tx
        .delete(duplicateCandidate)
        .where(
          sql`${duplicateCandidate.id} in (${sql.join(
            plan.duplicateCandidateIdsToDelete.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}) and ${duplicateCandidate.status} = 'open'`,
        )
        .returning({ id: duplicateCandidate.id });
      deletedDuplicateCandidateIds = deletedRows.map((r) => r.id);
    }

    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: REVERT_ACTION,
      metadata: {
        revertedAuditLogId: audit.id,
        personIdsReverted: revertedPersonIds,
        personsSkipped: plan.personsSkipped,
        duplicateCandidateIdsDeleted: deletedDuplicateCandidateIds,
        duplicateCandidatesSkipped: plan.duplicateCandidatesSkipped,
      },
    });
  });

  console.log("");
  console.log(`Reverted ${revertedPersonIds.length} person name(s).`);
  console.log(`Deleted ${deletedDuplicateCandidateIds.length} duplicate_candidate row(s).`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.execute && !args.actor) {
    throw new Error("--execute requires --actor=<bd id> for the audit log");
  }

  if (args.revert) {
    await runRevert(args);
  } else {
    await runForwardBackfill(args);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
