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
  libpqEnvFromDatabaseUrl,
  pgRestorePathFor,
  resolvePgDumpCandidates,
} from "@/lib/migration/backup";

// The homebrew libpq keg tracks the newest client, while a `pg_dump` on
// PATH can be an older server install (16.x) that refuses to dump the 17.x
// production server — so libpq is tried before PATH.
test("resolvePgDumpCandidates prefers PG_DUMP_PATH, then homebrew libpq, then PATH", () => {
  const withEnvVar = resolvePgDumpCandidates({ PG_DUMP_PATH: "/custom/pg_dump" });
  assert.deepEqual(withEnvVar, [
    "/custom/pg_dump",
    "/opt/homebrew/opt/libpq/bin/pg_dump",
    "pg_dump",
  ]);
});

test("resolvePgDumpCandidates without PG_DUMP_PATH tries homebrew libpq before PATH", () => {
  const withoutEnvVar = resolvePgDumpCandidates({});
  assert.deepEqual(withoutEnvVar, ["/opt/homebrew/opt/libpq/bin/pg_dump", "pg_dump"]);
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

// pg_dump/pg_restore do not read DATABASE_URL; they read libpq's PG* env
// vars. Passing only DATABASE_URL made pg_dump fall back to a local socket.
test("libpqEnvFromDatabaseUrl maps a postgres URL to libpq environment variables", () => {
  const env = libpqEnvFromDatabaseUrl(
    "postgresql://postgres.abc:p%40ss%2Fword@aws-0-sa-east-1.pooler.supabase.com:5432/postgres",
  );
  assert.deepEqual(env, {
    PGHOST: "aws-0-sa-east-1.pooler.supabase.com",
    PGPORT: "5432",
    PGUSER: "postgres.abc",
    PGPASSWORD: "p@ss/word",
    PGDATABASE: "postgres",
    PGSSLMODE: "require",
  });
});

test("libpqEnvFromDatabaseUrl keeps an explicit sslmode and defaults the port", () => {
  const env = libpqEnvFromDatabaseUrl("postgres://u:pw@db.example.com/app?sslmode=verify-full");
  assert.equal(env.PGPORT, "5432");
  assert.equal(env.PGDATABASE, "app");
  assert.equal(env.PGSSLMODE, "verify-full");
});

test("libpqEnvFromDatabaseUrl rejects a URL without a database", () => {
  assert.throws(() => libpqEnvFromDatabaseUrl("postgres://u:pw@db.example.com/"), /host and database/);
});

test("libpqEnvFromDatabaseUrl never leaks the password when the URL is invalid", () => {
  assert.throws(
    () => libpqEnvFromDatabaseUrl("postgres://u:s3cret@/"),
    (err: Error) => /host and database/.test(err.message) && !JSON.stringify(err).includes("s3cret") && !String(err).includes("s3cret"),
  );
});
