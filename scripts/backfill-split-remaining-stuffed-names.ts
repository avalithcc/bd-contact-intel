/**
 * One-off, owner-gated backfill: splits the REMAINING stuffed
 * `person.first_name` values that scripts/backfill-split-stuffed-names.ts
 * (PR #186, audit row df7a98fe) deliberately refused rather than guess at —
 * about 36 rows still have a full name in `first_name` with `last_name`
 * left empty. Uses the simpler, owner-approved rule from 2026-09-30 (see
 * src/lib/identity/stuffedNameFirstTokenSplit.ts for the exact rule and why
 * it is a SEPARATE, simpler rule from stuffedNameSplitBackfill.ts's
 * particle-aware one):
 *   1. First word is the first name, everything after is the last name.
 *   2. A middle initial right after the first word stays with the first
 *      name.
 *   3. Anything after a comma (a credential/title) is dropped.
 *   4. A value that becomes a single token after trimming is not split —
 *      reported in a "needs review" section instead.
 *
 * Reads the exact same candidate set as scripts/backfill-split-stuffed-
 * names.ts (readStuffedNameSplitCandidates: non-merged, first_name has
 * whitespace, last_name empty) — reused as-is rather than duplicating the
 * query, since the precondition is identical; only the SPLITTING rule
 * differs. Naturally idempotent: once a row is split, it no longer matches
 * that precondition and drops out of future candidate reads.
 *
 * `--execute` hardening (same shape as scripts/backfill-split-stuffed-names.ts):
 *   1. All or nothing — the batched name UPDATE and the `audit_log` INSERT
 *      run inside ONE `db.transaction`, one bulk `UPDATE ... FROM (VALUES ...)`
 *      statement, never one round trip per row.
 *   2. Audit trail — one `audit_log` row (action
 *      `person_first_token_split_backfill`), ONLY when at least one fill was
 *      applied. Metadata carries each applied fill's personId, the exact
 *      firstName/lastName written, AND the exact original (pre-backfill)
 *      firstName/lastName — the revert path needs the original values.
 *   3. Re-check before writing — the UPDATE's WHERE clause re-checks that
 *      first_name still equals exactly what was read AND last_name is still
 *      empty, at write time. A row that changed since the dry run is
 *      skipped, not overwritten, and reported as `fillsSkippedRace`.
 *
 * Revert: `--revert` (dry run) or `--revert --execute --actor=<bd id>`
 * (applies) — reuses the fully generic revert selection/plan from
 * src/lib/identity/stuffedNameSplitBackfillRevert.ts (same "never just
 * latest, refuse when several exist" rule), scoped to THIS backfill's own
 * `person_first_token_split_backfill` audit_log action so it can never be
 * confused with or revert PR #186's separate audit trail.
 *
 * Defaults to `--dry-run` (no writes) and REQUIRES `--execute --actor=<bd
 * id>` to actually write. Requires DATABASE_URL to be set (see .env).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-split-remaining-stuffed-names.ts                          # dry run (default)
 *   npx tsx --env-file=.env.local scripts/backfill-split-remaining-stuffed-names.ts --execute --actor=<bd id> # writes
 *   npx tsx --env-file=.env.local scripts/backfill-split-remaining-stuffed-names.ts --revert                  # revert dry run
 *   npx tsx --env-file=.env.local scripts/backfill-split-remaining-stuffed-names.ts --revert --execute --actor=<bd id>
 *   npx tsx --env-file=.env.local scripts/backfill-split-remaining-stuffed-names.ts --revert --audit-id=<uuid> [--execute --actor=<bd id>]
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog } from "../src/db/schema";
import {
  buildFirstTokenSplitPlan,
  type FirstTokenSplitRule,
} from "../src/lib/identity/stuffedNameFirstTokenSplit";
import {
  buildFirstTokenSplitAuditMetadata,
  isFirstTokenSplitAuditWorthRecording,
} from "../src/lib/identity/stuffedNameFirstTokenSplitAudit";
import {
  FIRST_TOKEN_SPLIT_BACKFILL_ACTION,
  FIRST_TOKEN_SPLIT_REVERT_ACTION,
  readAllFirstTokenSplitAuditRows,
} from "../src/lib/identity/stuffedNameFirstTokenSplitBackfillRevertDb";
import { readStuffedNameSplitCandidates } from "../src/lib/identity/stuffedNameSplitBackfillDb";
import {
  buildStuffedNameSplitRevertPlan,
  selectStuffedNameSplitAuditRow,
} from "../src/lib/identity/stuffedNameSplitBackfillRevert";
import { readCurrentPersonsByIds } from "../src/lib/identity/stuffedNameSplitBackfillRevertDb";

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

const RULE_ORDER: FirstTokenSplitRule[] = ["plain", "middle_initial"];

async function runForwardBackfill(args: Args) {
  const candidates = await readStuffedNameSplitCandidates();
  const plan = buildFirstTokenSplitPlan(candidates);

  console.log(`Candidates read (non-merged, first_name has whitespace, last_name empty): ${candidates.length}`);
  console.log(`Fills found: ${plan.fills.length}`);
  console.log(`Needs-review (skipped) found: ${plan.skips.length}`);

  const fillsByRule = new Map<FirstTokenSplitRule, typeof plan.fills>();
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

  console.log("");
  console.log(`Needs review — not split, single token after trim (${plan.skips.length}):`);
  for (const skip of plan.skips) {
    const flags = [
      skip.isDigitsOnly ? "digits" : null,
      skip.isCommonNonPersonWord ? "common non-person word" : null,
    ].filter((f): f is string => f !== null);
    const flagText = flags.length ? ` [${flags.join(", ")}]` : "";
    console.log(`  ${skip.personId}: "${skip.originalFirstName}"${flagText}`);
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
    rule: FirstTokenSplitRule;
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

    if (!isFirstTokenSplitAuditWorthRecording({ appliedFills })) return;

    const metadata = buildFirstTokenSplitAuditMetadata({
      fillsPlanned: plan.fills.length,
      appliedFills,
      skippedRacePersonIds,
    });
    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: FIRST_TOKEN_SPLIT_BACKFILL_ACTION,
      metadata,
    });
  });

  if (!isFirstTokenSplitAuditWorthRecording({ appliedFills })) {
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
  const rows = await readAllFirstTokenSplitAuditRows();
  const selection = selectStuffedNameSplitAuditRow(rows, args.auditId);

  if (selection.kind === "none") {
    console.log("No non-empty person_first_token_split_backfill audit_log row found — nothing to revert.");
    return;
  }
  if (selection.kind === "not_found") {
    const lines = [
      `--audit-id=${selection.requestedAuditId} does not match any non-empty person_first_token_split_backfill audit_log row.`,
      selection.candidates.length
        ? `Available non-empty rows:\n${selection.candidates.map(formatAuditCandidate).join("\n")}`
        : "There are no non-empty rows to revert at all.",
    ];
    throw new Error(lines.join("\n"));
  }
  if (selection.kind === "ambiguous") {
    const lines = [
      "More than one non-empty person_first_token_split_backfill audit_log row exists — refusing to guess which one to revert.",
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
      action: FIRST_TOKEN_SPLIT_REVERT_ACTION,
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
