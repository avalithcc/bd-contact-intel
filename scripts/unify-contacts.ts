/**
 * Collapse/fold-leads migration CLI (design.md "Migration plan", R10/R13;
 * contact-migration spec). This batch (Phase 3) only implements
 * `--phase=collapse`; `--phase=fold_leads` is Phase 4.
 *
 * Usage (do NOT run automatically — this reads/writes the real database
 * and, on --execute, shells out to pg_dump/pg_restore):
 *   npx tsx scripts/unify-contacts.ts --phase=collapse --dry-run
 *   npx tsx scripts/unify-contacts.ts --phase=collapse --execute --run=<migration_run id>
 *
 * `--dry-run` (the default when neither flag is passed) never writes
 * `person`/`person_bd_connection`/`person_id_map` rows — it only reads
 * `contact` and writes one `migration_run` report row. Review the report
 * in `/admin/migration` and click "Approve dry run" before running
 * `--execute`.
 *
 * `--execute --run=<id>` refuses (via
 * src/lib/migration/executionGuard.ts#assertExecutionAllowed) unless
 * `<id>` is an approved, not-yet-executed run whose `input_hash` still
 * matches the current `contact` table contents. Before writing anything it
 * backs up every involved table via `pg_dump` (see
 * src/lib/migration/backup.ts — resolves the binary from `PG_DUMP_PATH`,
 * else `pg_dump` on PATH, else the homebrew libpq install path) and
 * verifies the dump with `pg_restore --list`; either step failing aborts
 * before any write. On success it writes the collapse plan, marks the SAME
 * approved `migration_run` row as executed (linking rather than
 * orphaning), and writes one `audit_log(migration_execute)` entry — all in
 * one transaction (src/lib/migration/queries.ts#finalizeExecute).
 */
import { runCollapseDryRun, runCollapseExecute } from "../src/lib/migration/collapseRun";
import { snapshotBackup } from "../src/lib/migration/backup";
import {
  finalizeExecute,
  getMigrationRunForGate,
  readAllContactRows,
  saveDryRunReport,
} from "../src/lib/migration/queries";

interface Args {
  phase: "collapse" | "fold_leads";
  mode: "dry_run" | "execute";
  runId: string | null;
}

function parseArgs(argv: string[]): Args {
  const flags = new Set(argv);
  const runArg = argv.find((a) => a.startsWith("--run="));
  const phaseArg = argv.find((a) => a.startsWith("--phase="));
  const phase = phaseArg?.slice("--phase=".length);
  if (phase !== "collapse" && phase !== "fold_leads") {
    throw new Error(`--phase must be 'collapse' or 'fold_leads' (got ${phase ?? "none"})`);
  }
  if (phase === "fold_leads") {
    throw new Error("--phase=fold_leads is not implemented yet (Phase 4, PR 4)");
  }
  const mode = flags.has("--execute") ? "execute" : "dry_run";
  return { phase, mode, runId: runArg?.slice("--run=".length) ?? null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await readAllContactRows();

  if (args.mode === "dry_run") {
    const { migrationRunId, report } = await runCollapseDryRun(rows, { saveDryRunReport });
    console.log(`Dry run complete. migration_run id: ${migrationRunId}`);
    console.log(JSON.stringify(report, null, 2));
    console.log("Review this report in /admin/migration and approve it before --execute.");
    return;
  }

  if (!args.runId) {
    throw new Error("--execute requires --run=<migration_run id> (the approved dry run's id)");
  }
  const approvedRun = await getMigrationRunForGate(args.runId);
  const { migrationRunId, report } = await runCollapseExecute(rows, approvedRun, {
    snapshotBackup,
    finalizeExecute,
  });
  console.log(`Execute complete. migration_run id: ${migrationRunId}`);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
