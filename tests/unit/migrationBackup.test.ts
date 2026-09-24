/**
 * Unit tests for src/lib/migration/backup.ts's PURE parts — binary
 * resolution, file naming, command/args building, and the verification
 * decision (fresh-review fix: real pg_dump backup before --execute writes
 * anything). The real process-spawning snapshotBackup() is intentionally
 * NOT unit-tested here — see the file's header comment.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BACKUP_TABLES,
  backupFileName,
  buildPgDumpArgs,
  buildPgRestoreListArgs,
  evaluateBackupVerification,
  pgRestorePathFor,
  resolvePgDumpCandidates,
} from "@/lib/migration/backup";

test("resolvePgDumpCandidates prefers PG_DUMP_PATH, then PATH, then the homebrew fallback", () => {
  const withEnvVar = resolvePgDumpCandidates({ PG_DUMP_PATH: "/custom/pg_dump" });
  assert.deepEqual(withEnvVar, [
    "/custom/pg_dump",
    "pg_dump",
    "/opt/homebrew/opt/libpq/bin/pg_dump",
  ]);
});

test("resolvePgDumpCandidates without PG_DUMP_PATH skips straight to PATH then the fallback", () => {
  const withoutEnvVar = resolvePgDumpCandidates({});
  assert.deepEqual(withoutEnvVar, ["pg_dump", "/opt/homebrew/opt/libpq/bin/pg_dump"]);
});

test("resolvePgDumpCandidates never duplicates a candidate that equals the fallback", () => {
  const candidates = resolvePgDumpCandidates({
    PG_DUMP_PATH: "/opt/homebrew/opt/libpq/bin/pg_dump",
  });
  assert.deepEqual(candidates, ["/opt/homebrew/opt/libpq/bin/pg_dump", "pg_dump"]);
});

test("pgRestorePathFor derives pg_restore from a full pg_dump path in the same directory", () => {
  assert.equal(
    pgRestorePathFor("/opt/homebrew/opt/libpq/bin/pg_dump"),
    "/opt/homebrew/opt/libpq/bin/pg_restore",
  );
});

test("pgRestorePathFor falls back to the bare command name for a bare 'pg_dump'", () => {
  assert.equal(pgRestorePathFor("pg_dump"), "pg_restore");
});

test("backupFileName is stable and filesystem-safe (colons/dots in the timestamp are replaced)", () => {
  const name = backupFileName("run-123", "2026-01-02T03:04:05.678Z");
  assert.equal(name, "backups/run-123-2026-01-02T03-04-05-678Z.dump");
});

test("buildPgDumpArgs uses custom format and -t for every table, defaulting to BACKUP_TABLES", () => {
  const args = buildPgDumpArgs("backups/x.dump");
  assert.equal(args[0], "-Fc");
  assert.ok(args.includes("-f"));
  assert.ok(args.includes("backups/x.dump"));
  for (const table of BACKUP_TABLES) {
    assert.ok(args.includes(table), `expected -t ${table}`);
  }
});

test("buildPgDumpArgs respects an explicit table list", () => {
  const args = buildPgDumpArgs("backups/x.dump", ["contact", "lead"]);
  assert.deepEqual(args, ["-Fc", "-f", "backups/x.dump", "-t", "contact", "-t", "lead"]);
});

test("buildPgRestoreListArgs passes --list and the dump path", () => {
  assert.deepEqual(buildPgRestoreListArgs("backups/x.dump"), ["--list", "backups/x.dump"]);
});

test("evaluateBackupVerification rejects a non-zero pg_restore exit code", () => {
  const result = evaluateBackupVerification({
    restoreListExitCode: 1,
    restoreListStdout: "",
    fileSizeBytes: 5000,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /exit/i);
});

test("evaluateBackupVerification rejects a trivially small file", () => {
  const result = evaluateBackupVerification({
    restoreListExitCode: 0,
    restoreListStdout: "1234; some entry\n",
    fileSizeBytes: 10,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /bytes/i);
});

test("evaluateBackupVerification rejects an empty entry list", () => {
  const result = evaluateBackupVerification({
    restoreListExitCode: 0,
    restoreListStdout: "   \n  \n",
    fileSizeBytes: 5000,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /no entries/i);
});

test("evaluateBackupVerification accepts a clean exit, non-trivial size, and non-empty listing", () => {
  const result = evaluateBackupVerification({
    restoreListExitCode: 0,
    restoreListStdout: "1234; 0 0 TABLE public contact bd_user\n5678; 0 0 TABLE public lead bd_user\n",
    fileSizeBytes: 50_000,
  });
  assert.deepEqual(result, { ok: true });
});
