/**
 * Pure flag parser for scripts/unify-contacts.ts (design.md "Migration
 * plan"). Extracted from the script so the parsing rules are unit-testable
 * without a DB. Strict by design: only the four documented flags are
 * accepted, and `--execute`/`--dry-run` are mutually exclusive rather than
 * one silently winning.
 */
export interface MigrationCliArgs {
  phase: "collapse" | "fold_leads" | "catch_up";
  mode: "dry_run" | "execute";
  runId: string | null;
}

const VALID_FLAGS_HELP =
  "Valid flags are: --phase=<collapse|fold_leads|catch_up>, --execute, --dry-run, --run=<migration_run id>";

function isValidPhase(phase: string | undefined): phase is MigrationCliArgs["phase"] {
  return phase === "collapse" || phase === "fold_leads" || phase === "catch_up";
}

export function parseArgs(argv: readonly string[]): MigrationCliArgs {
  let phase: string | undefined;
  let runId: string | null = null;
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
    } else {
      throw new Error(`Unknown flag: ${arg}. ${VALID_FLAGS_HELP}`);
    }
  }

  if (!isValidPhase(phase)) {
    throw new Error(`--phase must be 'collapse', 'fold_leads' or 'catch_up' (got ${phase ?? "none"})`);
  }
  if (hasExecute && hasDryRun) {
    throw new Error("--execute and --dry-run cannot both be passed; pick one.");
  }

  return { phase, mode: hasExecute ? "execute" : "dry_run", runId };
}
