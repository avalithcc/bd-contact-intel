/**
 * Pre-`--execute` production backup (fresh-review fix; owner-approved
 * mechanism). Every table the collapse/fold-leads migration reads or
 * writes is `pg_dump`'d (custom format) to `backups/<runId>-<ts>.dump`
 * BEFORE any write happens, then verified with `pg_restore --list` plus a
 * minimum-size check. If either the dump or the verification fails, the
 * whole thing rejects and `collapseRun.ts#runCollapseExecute` never calls
 * `finalizeExecute` — see that file's header for the ordering guarantee.
 *
 * Split like matcher.ts/adminRole.ts: everything ABOVE `snapshotBackup` is
 * pure and unit-tested (tests/unit/migrationBackup.test.ts) — binary
 * resolution, file naming, argument building, and the verification
 * decision. `snapshotBackup` itself spawns real processes and touches the
 * filesystem; it is NOT unit-tested, same rationale as queries.ts.
 */
import { spawn } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Every table the collapse/fold-leads migration reads from or writes to
 * (legacy contact/lead universe, messaging, and every table added by
 * drizzle/0013_unified_person.sql).
 */
export const BACKUP_TABLES = [
  "contact",
  "lead",
  "lead_source",
  "activity",
  "task",
  "signal",
  "linkedin_scrape_job",
  "conversation",
  "message",
  "bd",
  "person",
  "person_bd_connection",
  "person_id_map",
  "person_property_history",
  "merge_event",
  "duplicate_candidate",
  "migration_run",
  "audit_log",
  "saved_view",
] as const;

const FALLBACK_PG_DUMP_PATH = "/opt/homebrew/opt/libpq/bin/pg_dump";
const MIN_BACKUP_SIZE_BYTES = 1024; // 1 KiB — a trivially small dump means an empty/broken backup.

/**
 * Resolution order: `PG_DUMP_PATH` env var, then `pg_dump` (relies on
 * PATH), then the known homebrew libpq install path (client pg_dump 18.6
 * on this project's dev machine; server is Postgres 17.6 via the Supabase
 * pooler, session mode, port 5432). Deduplicated, in priority order — the
 * real spawn logic (in `snapshotBackup`) tries each in turn until one
 * doesn't fail with ENOENT.
 */
export function resolvePgDumpCandidates(env: Record<string, string | undefined>): string[] {
  const candidates = [env.PG_DUMP_PATH, "pg_dump", FALLBACK_PG_DUMP_PATH];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}

/**
 * pg_dump and pg_restore ship side by side in the same bin directory, so
 * deriving pg_restore from whichever pg_dump path actually worked keeps
 * both binaries at the same version — safer than looking up a second,
 * independent env var that could point somewhere else entirely.
 */
export function pgRestorePathFor(pgDumpPath: string): string {
  if (pgDumpPath === "pg_dump") return "pg_restore";
  const match = /^(.*[/\\])pg_dump$/.exec(pgDumpPath);
  return match ? `${match[1]}pg_restore` : pgDumpPath;
}

/** Filesystem-safe: `:` and `.` in an ISO timestamp aren't safe on every OS/filesystem. */
export function backupFileName(runId: string, isoTimestamp: string): string {
  const safeTimestamp = isoTimestamp.replace(/[:.]/g, "-");
  return `backups/${runId}-${safeTimestamp}.dump`;
}

export function buildPgDumpArgs(
  outputPath: string,
  tables: readonly string[] = BACKUP_TABLES,
): string[] {
  return ["-Fc", "-f", outputPath, ...tables.flatMap((table) => ["-t", table])];
}

export function buildPgRestoreListArgs(dumpPath: string): string[] {
  return ["--list", dumpPath];
}

export interface BackupVerification {
  ok: boolean;
  reason?: string;
}

/** Pure decision: given pg_restore --list's result and the file size, is the backup good? */
export function evaluateBackupVerification(input: {
  restoreListExitCode: number;
  restoreListStdout: string;
  fileSizeBytes: number;
}): BackupVerification {
  if (input.restoreListExitCode !== 0) {
    return { ok: false, reason: `pg_restore --list exited with code ${input.restoreListExitCode}` };
  }
  if (input.fileSizeBytes < MIN_BACKUP_SIZE_BYTES) {
    return {
      ok: false,
      reason: `backup file is only ${input.fileSizeBytes} bytes (expected at least ${MIN_BACKUP_SIZE_BYTES})`,
    };
  }
  const entryCount = input.restoreListStdout.split("\n").filter((line) => line.trim().length > 0).length;
  if (entryCount === 0) {
    return { ok: false, reason: "pg_restore --list reported no entries" };
  }
  return { ok: true };
}

function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject); // e.g. ENOENT — binary not found at this candidate path
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function runWithFallback(
  candidates: string[],
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string; binaryUsed: string }> {
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const result = await runProcess(candidate, args, env);
      return { ...result, binaryUsed: candidate };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Real backup, real process spawn — NOT unit-tested (see file header).
 * Never logs `DATABASE_URL`; it's passed to the child process via `env`,
 * not as a command-line argument, so it never appears in `args`/process
 * listings either.
 */
export async function snapshotBackup(runId: string): Promise<string> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set — cannot back up before --execute.");
  }

  const outputPath = backupFileName(runId, new Date().toISOString());
  mkdirSync(dirname(outputPath), { recursive: true });

  const dumpCandidates = resolvePgDumpCandidates(process.env);
  const dumpResult = await runWithFallback(dumpCandidates, buildPgDumpArgs(outputPath), process.env);
  if (dumpResult.code !== 0) {
    throw new Error(`pg_dump exited with code ${dumpResult.code}: ${dumpResult.stderr}`);
  }

  const restorePath = pgRestorePathFor(dumpResult.binaryUsed);
  const restoreResult = await runWithFallback(
    [restorePath],
    buildPgRestoreListArgs(outputPath),
    process.env,
  );
  const fileSizeBytes = statSync(outputPath).size;
  const verification = evaluateBackupVerification({
    restoreListExitCode: restoreResult.code,
    restoreListStdout: restoreResult.stdout,
    fileSizeBytes,
  });
  if (!verification.ok) {
    throw new Error(`Backup verification failed for ${outputPath}: ${verification.reason}`);
  }

  return outputPath;
}
