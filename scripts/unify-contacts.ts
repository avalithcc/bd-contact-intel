/**
 * Collapse/fold-leads migration CLI (design.md "Migration plan", R10/R13;
 * contact-migration spec). `--phase=fold_leads` matches `lead` rows against
 * the persons the (already-executed) collapse phase created, via
 * src/lib/migration/foldRun.ts.
 *
 * Usage (do NOT run automatically — this reads/writes the real database
 * and, on --execute, shells out to pg_dump/pg_restore):
 *   npx tsx scripts/unify-contacts.ts --phase=collapse --dry-run
 *   npx tsx scripts/unify-contacts.ts --phase=collapse --execute --run=<migration_run id>
 *   npx tsx scripts/unify-contacts.ts --phase=fold_leads --dry-run
 *   npx tsx scripts/unify-contacts.ts --phase=fold_leads --execute --run=<migration_run id>
 *   npx tsx scripts/unify-contacts.ts --phase=catch_up --dry-run
 *   npx tsx scripts/unify-contacts.ts --phase=catch_up --execute --run=<migration_run id>
 *
 * `--phase=catch_up` (task 4B.8) processes only `contact`/`lead` rows absent
 * from `person_id_map` plus already-mapped leads edited since the LATEST
 * executed catch-up (or fold_leads, on the very first catch-up) run — see
 * src/lib/migration/catchUpQueries.ts's header for what it deliberately does
 * NOT cover (contact drift).
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
import { runFoldDryRun, runFoldExecute } from "../src/lib/migration/foldRun";
import { runCatchUpDryRun, runCatchUpExecute } from "../src/lib/migration/catchUpRun";
import { snapshotBackup } from "../src/lib/migration/backup";
import {
  finalizeExecute,
  finalizeFoldExecute,
  getLatestMigrationRun,
  getMigrationRunForGate,
  readActivityTypesByLeadId,
  readAllContactRows,
  readAllLeadRows,
  readExistingPersonsForFold,
  saveDryRunReport,
  saveFoldDryRunReport,
} from "../src/lib/migration/queries";
import {
  finalizeCatchUpExecute,
  readDriftedLeads,
  readExistingPersonsForCatchUp,
  readUnmappedContacts,
  readUnmappedLeads,
  saveCatchUpDryRunReport,
} from "../src/lib/migration/catchUpQueries";

interface Args {
  phase: "collapse" | "fold_leads" | "catch_up";
  mode: "dry_run" | "execute";
  runId: string | null;
}

function parseArgs(argv: string[]): Args {
  const flags = new Set(argv);
  const runArg = argv.find((a) => a.startsWith("--run="));
  const phaseArg = argv.find((a) => a.startsWith("--phase="));
  const phase = phaseArg?.slice("--phase=".length);
  if (phase !== "collapse" && phase !== "fold_leads" && phase !== "catch_up") {
    throw new Error(`--phase must be 'collapse', 'fold_leads' or 'catch_up' (got ${phase ?? "none"})`);
  }
  const mode = flags.has("--execute") ? "execute" : "dry_run";
  return { phase, mode, runId: runArg?.slice("--run=".length) ?? null };
}

async function runCollapsePhase(args: Args) {
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

async function runFoldLeadsPhase(args: Args) {
  const [existingPersons, leads, activityTypesByLeadId] = await Promise.all([
    readExistingPersonsForFold(),
    readAllLeadRows(),
    readActivityTypesByLeadId(),
  ]);

  if (args.mode === "dry_run") {
    const { migrationRunId, report } = await runFoldDryRun(existingPersons, leads, activityTypesByLeadId, {
      saveDryRunReport: saveFoldDryRunReport,
    });
    console.log(`Dry run complete. migration_run id: ${migrationRunId}`);
    console.log(JSON.stringify(report, null, 2));
    console.log("Review this report in /admin/migration and approve it before --execute.");
    return;
  }

  if (!args.runId) {
    throw new Error("--execute requires --run=<migration_run id> (the approved dry run's id)");
  }
  const approvedRun = await getMigrationRunForGate(args.runId);
  const { migrationRunId, report } = await runFoldExecute(
    existingPersons,
    leads,
    activityTypesByLeadId,
    approvedRun,
    { snapshotBackup, finalizeExecute: finalizeFoldExecute },
  );
  console.log(`Execute complete. migration_run id: ${migrationRunId}`);
  console.log(JSON.stringify(report, null, 2));
}

/**
 * Drift lookback (design: "leads by updated_at"): the latest EXECUTED
 * catch-up run's executedAt, or the latest executed fold_leads run's
 * executedAt on the very first catch-up (no prior catch-up to drift since),
 * or the epoch when neither has run yet (no lead could be "mapped" without
 * one of those two phases having executed first).
 */
async function driftSince(): Promise<Date> {
  const [latestCatchUp, latestFold] = await Promise.all([
    getLatestMigrationRun("catch_up"),
    getLatestMigrationRun("fold_leads"),
  ]);
  const executed = latestCatchUp?.executedAt ?? latestFold?.executedAt ?? null;
  return executed ?? new Date(0);
}

async function runCatchUpPhase(args: Args) {
  const since = await driftSince();
  const [unmappedContacts, unmappedLeads, driftedLeads] = await Promise.all([
    readUnmappedContacts(),
    readUnmappedLeads(),
    readDriftedLeads(since),
  ]);
  const contacts = unmappedContacts;
  const leads = [...unmappedLeads, ...driftedLeads];
  const existingPersons = await readExistingPersonsForCatchUp(contacts, leads);

  if (args.mode === "dry_run") {
    const { migrationRunId, report } = await runCatchUpDryRun(
      { contacts, leads },
      existingPersons,
      { saveDryRunReport: saveCatchUpDryRunReport },
    );
    console.log(`Dry run complete. migration_run id: ${migrationRunId}`);
    console.log(JSON.stringify(report, null, 2));
    console.log("Review this report in /admin/migration and approve it before --execute.");
    return;
  }

  if (!args.runId) {
    throw new Error("--execute requires --run=<migration_run id> (the approved dry run's id)");
  }
  const approvedRun = await getMigrationRunForGate(args.runId);
  const { migrationRunId, report } = await runCatchUpExecute({ contacts, leads }, existingPersons, approvedRun, {
    snapshotBackup,
    finalizeExecute: finalizeCatchUpExecute,
  });
  console.log(`Execute complete. migration_run id: ${migrationRunId}`);
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.phase === "collapse") return runCollapsePhase(args);
  if (args.phase === "fold_leads") return runFoldLeadsPhase(args);
  return runCatchUpPhase(args);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
