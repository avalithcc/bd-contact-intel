/**
 * Collapse/fold-leads migration CLI (design.md "Migration plan", R10/R13;
 * contact-migration spec). This batch (Phase 3) only implements
 * `--phase=collapse`; `--phase=fold_leads` is Phase 4.
 *
 * Usage (do NOT run automatically — this reads/writes the real database):
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
 * matches the current `contact` table contents. On success it writes the
 * collapse plan, marks the SAME approved `migration_run` row as executed
 * (linking rather than orphaning — see
 * src/lib/migration/collapseRun.ts#ApprovedMigrationRun), and writes one
 * `audit_log(migration_execute)` entry — all in one transaction
 * (src/lib/migration/queries.ts#finalizeExecute).
 *
 * It also refuses to proceed without a production backup — see
 * `snapshotBackup` below, which is NOT implemented yet: wiring it to this
 * project's actual backup mechanism is an infra decision for the owner,
 * out of scope for this commit. Until that's wired, `--execute` always
 * throws — this is a deliberate fail-safe, not an oversight.
 */
import { runCollapseDryRun, runCollapseExecute } from "../src/lib/migration/collapseRun";
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

/**
 * NOT IMPLEMENTED. Deliberately throws so `--execute` can never run
 * without a real backup wired in first (owner decision — see file header).
 */
async function snapshotBackup(): Promise<string> {
  throw new Error(
    "snapshotBackup() is not implemented — configure a production backup " +
      "strategy (see scripts/unify-contacts.ts header) before enabling --execute.",
  );
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
