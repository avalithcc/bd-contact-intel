/**
 * One-off, owner-gated backfill: fills EMPTY `person.first_name`/
 * `person.last_name` from the verified email's local part (e.g.
 * `efrain.romero@storicard.com` -> "Efrain" / "Romero"), for non-merged
 * persons whose first AND last name are BOTH empty. Refuses rather than
 * guesses — see src/lib/identity/nameFromEmailBackfill.ts for the exact
 * rule and every skip reason.
 *
 * Deliberately does NOT touch persons that have a first name but no last
 * name (a separate, out-of-scope problem — some of those have the full name
 * stuffed into first_name, and guessing a last name from the email there
 * would corrupt it, e.g. "Colette Harington" + "harrington@..." ->
 * "Colette Harington Harrington").
 *
 * Collision measurement (read-only, every run, dry run or execute): for
 * every planned fill, checks whether applying it would make the person share
 * `buildNameCompanyKey` (src/lib/identity/matcher.ts — the SAME key the live
 * identity matcher's name+company review rule uses) with an ALREADY
 * EXISTING, non-merged person. A collision here is reported, never
 * skipped — this backfill does not refuse to fill on a collision, since a
 * name+company match NEVER auto-merges (see matcher.ts's "review" case,
 * never "auto") and this script never writes to `duplicate_candidate` at
 * all (that table is only ever populated by live ingestion — see
 * src/lib/identity/resolveDb.ts). The report exists purely so the owner can
 * see, before approving, which fills would make a FUTURE ingestion row more
 * likely to land in the duplicate-review queue.
 *
 * `--execute` hardening (same shape as scripts/backfill-company-domains.ts):
 *   1. All or nothing — the batched UPDATE and the audit_log INSERT run
 *      inside ONE `db.transaction`. One bulk `UPDATE ... FROM (VALUES ...)`
 *      statement (src/lib/roleGroups.ts-style batching, see
 *      scripts/backfill-role-groups.ts), never one round trip per row.
 *   2. Audit trail — one `audit_log` row (action
 *      `person_name_from_email_backfill`) in the same transaction. Metadata
 *      only ever carries person UUIDS (see
 *      src/lib/identity/nameFromEmailBackfillAudit.ts) — never an email or a
 *      derived name, since those are PII and the ids alone are enough to
 *      revert.
 *   3. Re-check before writing — the UPDATE's WHERE clause re-checks BOTH
 *      first_name and last_name are still empty at write time, on top of the
 *      in-memory snapshot check the read already did. A row that changed
 *      since the dry run is skipped, not overwritten, and reported as
 *      `fillsSkippedRace` (audit metadata), never silently dropped.
 *
 * Revert: read the audit_log row's metadata (action =
 * 'person_name_from_email_backfill') and run:
 *   update person set first_name = null, last_name = null where id in (<personIds>);
 *
 * Defaults to `--dry-run` (no writes) and REQUIRES `--execute --actor=<bd
 * id>` to actually write. Requires DATABASE_URL to be set (see .env).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-person-names-from-email.ts                          # dry run (default)
 *   npx tsx --env-file=.env.local scripts/backfill-person-names-from-email.ts --execute --actor=<bd id> # writes
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog } from "../src/db/schema";
import {
  buildNameFromEmailPlan,
  findNameCompanyCollisions,
  type NameFromEmailSkipReason,
} from "../src/lib/identity/nameFromEmailBackfill";
import { buildNameFromEmailBackfillAuditMetadata } from "../src/lib/identity/nameFromEmailBackfillAudit";
import { readCollisionCandidates, readNameFromEmailBackfillCandidates } from "../src/lib/identity/nameFromEmailBackfillDb";

interface Args {
  execute: boolean;
  actor: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false; // explicit no-op, dry-run is already the default
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --execute, --dry-run, --actor=<bd id>`);
  }
  return { execute, actor };
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.execute && !args.actor) {
    throw new Error("--execute requires --actor=<bd id> for the audit log");
  }

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

  console.log("");
  console.log(
    `Name+company collisions (this fill would newly match buildNameCompanyKey against an EXISTING person — ` +
      `never auto-merges, only makes a future ingestion row more likely to be queued for review): ${collisions.length}`,
  );
  for (const collision of collisions) {
    console.log(
      `  ${collision.email} -> ${collision.firstName} ${collision.lastName} @ ${collision.companyKey} ` +
        `collides with person id(s): ${collision.collidesWithPersonIds.join(", ")}`,
    );
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

  const appliedPersonIds: string[] = [];
  const skippedRacePersonIds: string[] = [];

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
        if (updatedIds.has(fill.personId)) appliedPersonIds.push(fill.personId);
        else skippedRacePersonIds.push(fill.personId);
      }
    }

    const metadata = buildNameFromEmailBackfillAuditMetadata({
      fillsPlanned: plan.fills.length,
      appliedPersonIds,
      skippedRacePersonIds,
    });
    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: "person_name_from_email_backfill",
      metadata,
    });
  });

  console.log("");
  console.log(`Applied ${appliedPersonIds.length} name fill(s).`);
  if (skippedRacePersonIds.length) {
    console.log(
      `${skippedRacePersonIds.length} planned fill(s) were skipped — the person's name was no longer empty at ` +
        "write time (see audit_log for the exact set).",
    );
  }
  if (appliedPersonIds.length !== plan.fills.length) {
    console.log(
      `Applied (${appliedPersonIds.length}) does not equal planned (${plan.fills.length}) — ` +
        `fully explained by the ${skippedRacePersonIds.length} skipped above.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
