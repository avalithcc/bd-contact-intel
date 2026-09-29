/**
 * One-off, owner-gated backfill: splits a full name that was stuffed into
 * `person.first_name` (with `last_name` left empty) into `first_name`/
 * `last_name` — e.g. "Colette Harington" -> "Colette" / "Harington". Refuses
 * rather than guesses — see src/lib/identity/stuffedNameSplitBackfill.ts for
 * the exact rule (surname particles, the 4-token Hispanic-naming heuristic,
 * the email tie-breaker, and every skip reason) and why it is a SEPARATE
 * rule from src/lib/contacts/partnerAccountContacts.ts#splitDisplayName
 * (that rule is a simple "last token is the surname" heuristic, known-wrong
 * for particles — its own file requires a hand-verified override for
 * "Claudio De Vita" for exactly that reason).
 *
 * Does NOT queue any `duplicate_candidate` rows: `buildNameCompanyKey`
 * (src/lib/identity/matcher.ts) keys on the whitespace-collapsed
 * concatenation of firstName+lastName, so re-partitioning the same tokens
 * into first/last can never change that key — see the module doc comment
 * in stuffedNameSplitBackfill.ts and its "key invariance" test.
 *
 * `--execute` hardening (same shape as scripts/backfill-person-names-from-email.ts):
 *   1. All or nothing — the batched name UPDATE and the `audit_log` INSERT
 *      run inside ONE `db.transaction`, one bulk `UPDATE ... FROM (VALUES ...)`
 *      statement, never one round trip per row.
 *   2. Audit trail — one `audit_log` row (action
 *      `person_stuffed_name_split_backfill`), ONLY when at least one fill was
 *      applied (a no-op re-run must never write an empty audit row — it
 *      would hide the real backfill from `--revert`). Metadata carries each
 *      applied fill's personId, the exact firstName/lastName written, AND
 *      the exact original (pre-backfill) firstName/lastName — the revert
 *      path needs the original values, not just NULL/NULL.
 *   3. Re-check before writing — the UPDATE's WHERE clause re-checks that
 *      first_name still equals exactly what was read AND last_name is still
 *      empty, at write time. A row that changed since the dry run is
 *      skipped, not overwritten, and reported as `fillsSkippedRace`.
 *
 * Revert: `--revert` (dry run) or `--revert --execute --actor=<bd id>`
 * (applies) — same "never just latest, refuse when several exist" selection
 * rule as scripts/backfill-person-names-from-email.ts. See
 * src/lib/identity/stuffedNameSplitBackfillRevert.ts#selectStuffedNameSplitAuditRow.
 * Only ever reverts a person whose CURRENT name still equals exactly what
 * the SELECTED run wrote (a BD's later correction is never silently wiped).
 *
 * Defaults to `--dry-run` (no writes) and REQUIRES `--execute --actor=<bd
 * id>` to actually write. Requires DATABASE_URL to be set (see .env).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-split-stuffed-names.ts                          # dry run (default)
 *   npx tsx --env-file=.env.local scripts/backfill-split-stuffed-names.ts --execute --actor=<bd id> # writes
 *   npx tsx --env-file=.env.local scripts/backfill-split-stuffed-names.ts --revert                  # revert dry run
 *   npx tsx --env-file=.env.local scripts/backfill-split-stuffed-names.ts --revert --execute --actor=<bd id>
 *   npx tsx --env-file=.env.local scripts/backfill-split-stuffed-names.ts --revert --audit-id=<uuid> [--execute --actor=<bd id>]
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog } from "../src/db/schema";
import {
  buildStuffedNameSplitPlan,
  type StuffedNameSplitRule,
  type StuffedNameSplitSkipReason,
} from "../src/lib/identity/stuffedNameSplitBackfill";
import {
  buildStuffedNameSplitAuditMetadata,
  isStuffedNameSplitAuditWorthRecording,
} from "../src/lib/identity/stuffedNameSplitBackfillAudit";
import { readStuffedNameSplitCandidates } from "../src/lib/identity/stuffedNameSplitBackfillDb";
import {
  buildStuffedNameSplitRevertPlan,
  selectStuffedNameSplitAuditRow,
} from "../src/lib/identity/stuffedNameSplitBackfillRevert";
import {
  readAllStuffedNameSplitAuditRows,
  readCurrentPersonsByIds,
  STUFFED_NAME_SPLIT_BACKFILL_ACTION,
  STUFFED_NAME_SPLIT_REVERT_ACTION,
} from "../src/lib/identity/stuffedNameSplitBackfillRevertDb";

interface Args {
  execute: boolean;
  actor: string | null;
  revert: boolean;
  auditId: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let execute = false;
  let actor: string | null = null;
  let revert = false;
  let auditId: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false;
    else if (arg === "--revert") revert = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--audit-id=")) auditId = arg.slice("--audit-id=".length);
    else {
      throw new Error(
        `Unknown argument: ${arg}. Valid: --execute, --dry-run, --revert, --actor=<bd id>, --audit-id=<uuid>`,
      );
    }
  }
  return { execute, actor, revert, auditId };
}

const RULE_ORDER: StuffedNameSplitRule[] = ["two_tokens", "particle", "email_resolved", "heuristic_4"];
const SKIP_REASON_ORDER: StuffedNameSplitSkipReason[] = [
  "single_token",
  "junk_digit",
  "junk_at",
  "junk_scrape_artifact",
  "junk_punctuation",
  "looks_like_company",
  "ambiguous_3",
  "ambiguous_many",
];

async function runForwardBackfill(args: Args) {
  const candidates = await readStuffedNameSplitCandidates();
  const plan = buildStuffedNameSplitPlan(candidates);

  console.log(`Candidates read (non-merged, first_name has whitespace, last_name empty): ${candidates.length}`);
  console.log(`Fills found: ${plan.fills.length}`);
  console.log(`Skips found: ${plan.skips.length}`);

  console.log("");
  console.log("Duplicate_candidate rows queued: 0 — splitting never changes buildNameCompanyKey (whitespace-");
  console.log("collapsed firstName+lastName re-concatenates to the same string), so this backfill can never");
  console.log("introduce a NEW name+company collision. See stuffedNameSplitBackfill.ts's doc comment.");

  const fillsByRule = new Map<StuffedNameSplitRule, typeof plan.fills>();
  for (const fill of plan.fills) {
    const list = fillsByRule.get(fill.rule) ?? [];
    list.push(fill);
    fillsByRule.set(fill.rule, list);
  }
  console.log("");
  console.log(`Every proposed split (${plan.fills.length}), grouped by rule:`);
  for (const rule of RULE_ORDER) {
    const list = fillsByRule.get(rule) ?? [];
    if (list.length === 0) continue;
    console.log(`  ${rule} (${list.length}):`);
    for (const fill of list) {
      console.log(`    "${fill.originalFirstName}" -> "${fill.firstName}" / "${fill.lastName}"`);
    }
  }

  const skipsByReason = new Map<StuffedNameSplitSkipReason, typeof plan.skips>();
  for (const skip of plan.skips) {
    const list = skipsByReason.get(skip.reason) ?? [];
    list.push(skip);
    skipsByReason.set(skip.reason, list);
  }
  console.log("");
  console.log("Skips grouped by reason (up to 10 examples each):");
  for (const reason of SKIP_REASON_ORDER) {
    const list = skipsByReason.get(reason) ?? [];
    if (list.length === 0) continue;
    console.log(`  ${reason} (${list.length}):`);
    for (const skip of list.slice(0, 10)) {
      console.log(`    "${skip.originalFirstName}"`);
    }
  }

  if (!args.execute) {
    console.log("");
    console.log("Dry run only — no writes performed. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  const appliedFills: {
    personId: string;
    firstName: string;
    lastName: string;
    originalFirstName: string;
    originalLastName: string | null;
    rule: StuffedNameSplitRule;
  }[] = [];
  const skippedRacePersonIds: string[] = [];

  await db.transaction(async (tx) => {
    if (plan.fills.length > 0) {
      const values = plan.fills.map(
        (fill) =>
          sql`(${fill.personId}::uuid, ${fill.firstName}::text, ${fill.lastName}::text, ${fill.originalFirstName}::text)`,
      );
      const updatedRows = (await tx.execute(sql`
        UPDATE person AS p
        SET first_name = v.first_name,
            last_name = v.last_name,
            updated_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, first_name, last_name, original_first_name)
        WHERE p.id = v.id
          AND p.first_name = v.original_first_name
          AND (p.last_name IS NULL OR btrim(p.last_name) = '')
        RETURNING p.id
      `)) as unknown as { id: string }[];

      const updatedIds = new Set(updatedRows.map((r) => r.id));
      for (const fill of plan.fills) {
        if (updatedIds.has(fill.personId)) {
          appliedFills.push({
            personId: fill.personId,
            firstName: fill.firstName,
            lastName: fill.lastName,
            originalFirstName: fill.originalFirstName,
            originalLastName: fill.originalLastName,
            rule: fill.rule,
          });
        } else {
          skippedRacePersonIds.push(fill.personId);
        }
      }
    }

    if (!isStuffedNameSplitAuditWorthRecording({ appliedFills })) return;

    const metadata = buildStuffedNameSplitAuditMetadata({
      fillsPlanned: plan.fills.length,
      appliedFills,
      skippedRacePersonIds,
    });
    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: STUFFED_NAME_SPLIT_BACKFILL_ACTION,
      metadata,
    });
  });

  if (!isStuffedNameSplitAuditWorthRecording({ appliedFills })) {
    console.log("");
    console.log("Nothing to do — no fills applied. No audit_log row written.");
    return;
  }

  console.log("");
  console.log(`Applied ${appliedFills.length} name split(s).`);
  if (skippedRacePersonIds.length) {
    console.log(
      `${skippedRacePersonIds.length} planned fill(s) were skipped — the person's row changed since the dry ` +
        "run (see audit_log for the exact set).",
    );
  }
  if (appliedFills.length !== plan.fills.length) {
    console.log(
      `Applied (${appliedFills.length}) does not equal planned (${plan.fills.length}) — ` +
        `fully explained by the ${skippedRacePersonIds.length} skipped above.`,
    );
  }
}

function formatAuditCandidate(c: { id: string; at: Date; actorBdId: string; fillCount: number }): string {
  return `  ${c.id} — at=${c.at.toISOString()} actor=${c.actorBdId} fills=${c.fillCount}`;
}

async function runRevert(args: Args) {
  const rows = await readAllStuffedNameSplitAuditRows();
  const selection = selectStuffedNameSplitAuditRow(rows, args.auditId);

  if (selection.kind === "none") {
    console.log("No non-empty person_stuffed_name_split_backfill audit_log row found — nothing to revert.");
    return;
  }
  if (selection.kind === "not_found") {
    const lines = [
      `--audit-id=${selection.requestedAuditId} does not match any non-empty person_stuffed_name_split_backfill audit_log row.`,
      selection.candidates.length
        ? `Available non-empty rows:\n${selection.candidates.map(formatAuditCandidate).join("\n")}`
        : "There are no non-empty rows to revert at all.",
    ];
    throw new Error(lines.join("\n"));
  }
  if (selection.kind === "ambiguous") {
    const lines = [
      "More than one non-empty person_stuffed_name_split_backfill audit_log row exists — refusing to guess which one to revert.",
      "Re-run with --audit-id=<uuid> to choose one explicitly:",
      selection.candidates.map(formatAuditCandidate).join("\n"),
    ];
    throw new Error(lines.join("\n"));
  }

  const audit = selection.row;
  console.log(`Reverting audit_log row ${audit.id}: ${audit.fills.length} fill(s).`);

  const currentPersons = await readCurrentPersonsByIds(audit.fills.map((f) => f.personId));
  const plan = buildStuffedNameSplitRevertPlan({ auditedFills: audit.fills, currentPersons });

  console.log("");
  console.log(`Persons to revert to their original stuffed name (${plan.toRevert.length}):`);
  for (const item of plan.toRevert) {
    console.log(`  ${item.personId} -> "${item.originalFirstName}" / ${JSON.stringify(item.originalLastName)}`);
  }
  if (plan.skipped.length) {
    console.log(`Persons skipped (${plan.skipped.length}):`);
    for (const skip of plan.skipped) console.log(`  ${skip.personId}: ${skip.reason}`);
  }

  if (!args.execute) {
    console.log("");
    console.log("Revert dry run only — no writes performed. Re-run with --revert --execute --actor=<bd id> to apply.");
    return;
  }

  let revertedPersonIds: string[] = [];

  await db.transaction(async (tx) => {
    const fillByPersonId = new Map(audit.fills.map((f) => [f.personId, f] as const));
    if (plan.toRevert.length > 0) {
      const values = plan.toRevert.map((item) => {
        const fill = fillByPersonId.get(item.personId)!;
        return sql`(${item.personId}::uuid, ${fill.firstName}::text, ${fill.lastName}::text, ${item.originalFirstName}::text, ${item.originalLastName}::text)`;
      });
      const revertedRows = (await tx.execute(sql`
        UPDATE person AS p
        SET first_name = v.original_first_name,
            last_name = v.original_last_name,
            updated_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, first_name, last_name, original_first_name, original_last_name)
        WHERE p.id = v.id
          AND p.first_name = v.first_name
          AND p.last_name = v.last_name
        RETURNING p.id
      `)) as unknown as { id: string }[];
      revertedPersonIds = revertedRows.map((r) => r.id);
    }

    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: STUFFED_NAME_SPLIT_REVERT_ACTION,
      metadata: {
        revertedAuditLogId: audit.id,
        personIdsReverted: revertedPersonIds,
        personsSkipped: plan.skipped,
      },
    });
  });

  console.log("");
  console.log(`Reverted ${revertedPersonIds.length} person name(s).`);
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
