/**
 * One-off, owner-gated backfill: sets a default `company.relationship_stage`
 * on every company row where it is currently NULL — owner-approved
 * 2026-09-29, see
 * openspec/decisions/2026-09-30-decision-brief.md, "2. Default pipeline
 * stage — decided". NEVER touches a row whose `relationship_stage` is
 * already set (a BD's own choice is never overwritten).
 *
 * The rule (src/lib/companies/defaultPipelineStage.ts carries the tested
 * logic; src/lib/companies/defaultPipelineStageDb.ts computes the one
 * signal it needs):
 *   1. `account_type = 'client'`  -> won
 *   2. `account_type = 'partner'` -> qualified
 *   3. Otherwise, if >=1 non-merged contact at that company has status
 *      'replied' or 'meeting' AND an effective last touch within the last
 *      12 months -> qualified. "Effective last touch" is the greatest of
 *      the activity-derived time and `person_bd_connection.last_message_at`
 *      — exactly src/lib/contacts/effectiveActivityTime.ts#effectiveActivityAtSql,
 *      never a second definition of that rule.
 *   4. Otherwise -> prospect
 *
 * Expected result against production (measured by the orchestrator
 * 2026-09-29, read-only): 2 won, 831 qualified, 13,422 prospect, out of
 * 14,255 companies (all currently null). This script's dry-run output
 * prints the same per-stage counts so they can be diffed against that
 * number before anyone runs `--execute`.
 *
 * `--execute` hardening (same shape as scripts/backfill-company-account-type.ts
 * and scripts/backfill-person-names-from-email.ts):
 *   1. All or nothing — every UPDATE and the `audit_log` INSERT run inside
 *      ONE `db.transaction`. The UPDATE is a single set-based
 *      `UPDATE ... FROM (VALUES ...)` statement per batch (WRITE_BATCH_SIZE
 *      rows/batch, see src/lib/migration/collapseWriteRows.ts#chunk) —
 *      never one round trip per company, and never one UPDATE per stage
 *      (all three stages' rows are batched together, keyed by
 *      `(company_key, stage)` VALUES pairs).
 *   2. Audit trail — one `audit_log` row (action
 *      `company_default_pipeline_stage_backfill`) in the same transaction,
 *      ONLY when at least one row was actually updated
 *      (isDefaultPipelineStageAuditWorthRecording — a no-op re-run must
 *      never write an empty audit row). Metadata
 *      (src/lib/companies/defaultPipelineStageAudit.ts) carries the exact
 *      count AND the full company_key list per stage (bounded by the whole
 *      `company` table, not by an arbitrary small cap — see that module's
 *      doc comment for why this differs from bulkOwnerAudit's 100-row cap),
 *      so a revert never has to guess which companies this run touched.
 *   3. Re-check before writing — the UPDATE's WHERE clause re-checks
 *      `relationship_stage IS NULL` at write time, on top of the read that
 *      already filtered on it. A company a BD set a stage on between the
 *      read and the write is skipped, not overwritten, and reported as
 *      `skippedRace` (planned count minus applied count).
 *
 * No `company_property_history` rows are written. The app's own inline
 * stage edit (updateCompanyStageAction, src/app/(app)/companies/actions.ts)
 * does NOT write `company_property_history` for a stage change either — it
 * writes a `status_change` activity row instead, and only
 * `industry`/`ownerBdId`/`city`/`country` go through
 * `company_property_history` (see src/lib/companies/propertyEditDb.ts,
 * src/lib/companies/propertyEdit.ts's `EDITABLE_COMPANY_PROPERTIES`,
 * which does not include `relationshipStage`). Mirroring the app exactly:
 * this backfill writes no `company_property_history` rows and no
 * `status_change` activity rows either — 14,255 synthetic "stage changed
 * from null" activity rows would flood every affected company's timeline
 * with a system event no BD ever triggered, which the *inline edit*
 * feature (a real, single, BD-driven action) is designed to show, not a
 * one-time bulk default. The single `audit_log` row is the complete,
 * queryable record of this run.
 *
 * Revert: read the `audit_log` row for action
 * `company_default_pipeline_stage_backfill` and run (see
 * defaultPipelineStageAudit.ts's doc comment for the full statements):
 *   update company set relationship_stage = null
 *     where relationship_stage = '<stage>' and company_key in (<...CompanyKeys>);
 * for each of the three stages — the `relationship_stage = '<stage>'`
 * re-check means a company a BD has since hand-edited is never silently
 * reverted. No `--revert` flag is implemented here (unlike
 * backfill-person-names-from-email.ts) — the statements above are the
 * documented path; add one only if the owner asks for a repeatable revert.
 *
 * Defaults to `--dry-run` (no writes) and REQUIRES `--execute --actor=<bd
 * id>` to actually write. Requires DATABASE_URL to be set (see .env).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-default-pipeline-stage.ts                          # dry run (default)
 *   npx tsx --env-file=.env.local scripts/backfill-default-pipeline-stage.ts --execute --actor=<bd id> # writes
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog } from "../src/db/schema";
import {
  classifyDefaultPipelineStage,
  planDefaultPipelineStages,
  type DefaultPipelineStage,
} from "../src/lib/companies/defaultPipelineStage";
import {
  buildDefaultPipelineStageAuditMetadata,
  isDefaultPipelineStageAuditWorthRecording,
} from "../src/lib/companies/defaultPipelineStageAudit";
import { readCompanyDefaultStageCandidates } from "../src/lib/companies/defaultPipelineStageDb";
import { chunk } from "../src/lib/migration/collapseWriteRows";

const WRITE_BATCH_SIZE = 1000;
const STAGE_ORDER: DefaultPipelineStage[] = ["won", "qualified", "prospect"];

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.execute && !args.actor) {
    throw new Error("--execute requires --actor=<bd id> for the audit log");
  }

  const candidates = await readCompanyDefaultStageCandidates();
  const plan = planDefaultPipelineStages(candidates);

  console.log(`Companies with relationship_stage IS NULL: ${candidates.length}`);
  for (const stage of STAGE_ORDER) {
    console.log(`  ${stage}: ${plan.byStage[stage].length}`);
  }

  // Sanity check the classifier's math against the candidates it was given
  // — every candidate resolves to exactly one stage, no company is dropped
  // or double-counted.
  const totalClassified = STAGE_ORDER.reduce((sum, stage) => sum + plan.byStage[stage].length, 0);
  if (totalClassified !== candidates.length) {
    throw new Error(
      `Classifier accounting mismatch: ${totalClassified} classified vs ${candidates.length} candidates read`,
    );
  }

  if (!args.execute) {
    console.log("");
    console.log("Dry run only — no writes performed. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  const appliedByStage: Record<DefaultPipelineStage, string[]> = { won: [], qualified: [], prospect: [] };

  await db.transaction(async (tx) => {
    const allRows = candidates.map((c) => ({
      companyKey: c.companyKey,
      stage: classifyDefaultPipelineStage(c),
    }));

    for (const batch of chunk(allRows, WRITE_BATCH_SIZE)) {
      if (!batch.length) continue;
      const values = batch.map((row) => sql`(${row.companyKey}::text, ${row.stage}::text)`);
      const updatedRows = (await tx.execute(sql`
        UPDATE company AS c
        SET relationship_stage = v.stage,
            updated_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(company_key, stage)
        WHERE c.company_key = v.company_key
          AND c.relationship_stage IS NULL
        RETURNING c.company_key, v.stage
      `)) as unknown as { company_key: string; stage: DefaultPipelineStage }[];

      for (const row of updatedRows) {
        appliedByStage[row.stage].push(row.company_key);
      }
    }

    if (!isDefaultPipelineStageAuditWorthRecording({ appliedByStage })) return;

    const metadata = buildDefaultPipelineStageAuditMetadata({ appliedByStage });
    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: "company_default_pipeline_stage_backfill",
      metadata,
    });
  });

  if (!isDefaultPipelineStageAuditWorthRecording({ appliedByStage })) {
    console.log("");
    console.log("Nothing to do — no rows updated (every candidate's stage was set by someone else since the dry run). No audit_log row written.");
    return;
  }

  console.log("");
  let totalApplied = 0;
  for (const stage of STAGE_ORDER) {
    const applied = appliedByStage[stage].length;
    const planned = plan.byStage[stage].length;
    totalApplied += applied;
    console.log(`Applied ${applied}/${planned} ${stage}${applied !== planned ? ` (${planned - applied} skipped — race)` : ""}`);
  }
  console.log(`Total applied: ${totalApplied}/${candidates.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
