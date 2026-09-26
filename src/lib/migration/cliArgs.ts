/**
 * Pure flag parser for scripts/unify-contacts.ts (design.md "Migration
 * plan"). Extracted from the script so the parsing rules are unit-testable
 * without a DB. Strict by design: only the documented flags are accepted,
 * and `--execute`/`--dry-run` are mutually exclusive rather than one
 * silently winning.
 *
 * `--phase=hubspot_import` (design D6, task 4.3) additionally requires
 * `--file=<path>` (the contacts CSV) and `--companies=<path>` (the
 * companies CSV) for BOTH `--dry-run` and `--execute` — the planner always
 * needs both files to re-plan and re-hash. Every other phase rejects them,
 * so a stray `--file=` flag on `--phase=collapse` fails loudly instead of
 * being silently ignored.
 */
export interface MigrationCliArgs {
  phase: "collapse" | "fold_leads" | "catch_up" | "hubspot_import";
  mode: "dry_run" | "execute";
  runId: string | null;
  file: string | null;
  companies: string | null;
}

const VALID_FLAGS_HELP =
  "Valid flags are: --phase=<collapse|fold_leads|catch_up|hubspot_import>, --execute, --dry-run, " +
  "--run=<migration_run id>, --file=<path> (hubspot_import only), --companies=<path> (hubspot_import only)";

function isValidPhase(phase: string | undefined): phase is MigrationCliArgs["phase"] {
  return phase === "collapse" || phase === "fold_leads" || phase === "catch_up" || phase === "hubspot_import";
}

export function parseArgs(argv: readonly string[]): MigrationCliArgs {
  let phase: string | undefined;
  let runId: string | null = null;
  let file: string | null = null;
  let companies: string | null = null;
  let hasExecute = false;
  let hasDryRun = false;

  for (const arg of argv) {
    if (arg.startsWith("--phase=")) {
      phase = arg.slice("--phase=".length);
    } else if (arg === "--execute") {
      hasExecute = true;
    } else if (arg === "--dry-run") {
      hasDryRun = true;
    } else if (arg.startsWith("--run=")) {
      runId = arg.slice("--run=".length);
    } else if (arg.startsWith("--file=")) {
      file = arg.slice("--file=".length);
    } else if (arg.startsWith("--companies=")) {
      companies = arg.slice("--companies=".length);
    } else {
      throw new Error(`Unknown flag: ${arg}. ${VALID_FLAGS_HELP}`);
    }
  }

  if (!isValidPhase(phase)) {
    throw new Error(
      `--phase must be 'collapse', 'fold_leads', 'catch_up' or 'hubspot_import' (got ${phase ?? "none"})`,
    );
  }
  if (hasExecute && hasDryRun) {
    throw new Error("--execute and --dry-run cannot both be passed; pick one.");
  }

  if (phase === "hubspot_import") {
    if (!file || !companies) {
      throw new Error("--phase=hubspot_import requires both --file=<path> and --companies=<path>");
    }
  } else if (file || companies) {
    throw new Error(`--file/--companies are only valid with --phase=hubspot_import. ${VALID_FLAGS_HELP}`);
  }

  return { phase, mode: hasExecute ? "execute" : "dry_run", runId, file, companies };
}
