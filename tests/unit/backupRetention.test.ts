/**
 * Retention of the `backups/` dumps. The risk here is not the arithmetic — it is deleting one of the files
 * that live BESIDE the dumps in that directory and exist nowhere else: event attendee lists, account
 * spreadsheets, a PDF, loose .txt working files, a JSON snapshot, a `contratos/` directory. So the fixture
 * below is the whole directory as it stood on 2026-10-28 (12 dumps, 19 other files, 1 directory), and the
 * eligibility tests run against that mixed listing rather than a tidy one.
 *
 * `backupsToPrune` is the pure decision and takes names. `pruneOldBackups` touches the filesystem and is
 * covered against a temp directory — never against the real `backups/`.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { backupFileName } from "@/lib/migration/backup";
import {
  backupsToPrune,
  DEFAULT_BACKUP_RETENTION,
  parseBackupFileName,
  pruneOldBackups,
  retentionFromEnv,
} from "@/lib/migration/backupRetention";

const NOW = new Date("2026-10-28T12:30:00.000Z");
const FAR_FUTURE = new Date("2099-01-01T00:00:00.000Z");

const DUMPS = [
  "b9003aae-7c04-43a2-b9d3-df3126a0acc7-2026-09-24T21-02-48-283Z.dump",
  "b9003aae-7c04-43a2-b9d3-df3126a0acc7-2026-09-25T01-17-12-688Z.dump",
  "before-merge-accenture-argentina-2026-10-27T13-09-27-222Z.dump",
  "c9de8587-face-4f51-affc-0cee5967a431-2026-09-26T20-11-11-196Z.dump",
  "merge-companies-bbva-2026-10-27T21-31-01-008Z.dump",
  "merge-companies-galicia-kavak-huenei-2026-10-09-2026-10-09T12-11-58-239Z.dump",
  "merge-companies-lot1-2026-10-27T21-03-32-634Z.dump",
  "merge-companies-lot2-2026-10-27T21-28-09-034Z.dump",
  "merge-companies-lot2-rest-2026-10-28T11-52-08-233Z.dump",
  "merge-duplicates-60-2026-10-27T21-48-43Z.dump",
  "merge-duplicates-8-2026-10-28T12-03-08-205Z.dump",
  "posting-market-backfill-2026-10-27T19-12-09-493Z.dump",
];

/** Everything else really in backups/. None of it may ever be returned for deletion. */
const NOT_DUMPS = [
  "clave-company.txt",
  "claves-huerfanas.txt",
  "claves-no-empresa.txt",
  "claves-retenidas.txt",
  "contactos-comerciales 1.pdf",
  "contactos.txt",
  "contratos",
  "empleadores-no-empresa.txt",
  "empresas-avalith-2026-09-28(in).csv",
  "empresas-duplicadas.txt",
  "grupo-quares.json",
  "grupos-fusion-54.txt",
  "grupos-fusion.txt",
  "listado_final_digital_finance_forum.xlsx - Inscriptos presenciales.csv",
  "own-company-cleanup-snapshot-2026-09-28T14-36-38-699Z.json",
  "PARA_LLAMAR hoteles - PARA_LLAMAR.csv",
  "SEGUIMIENTO de cuentas MATÍAS & MACARENA-Cuentas Pablo.csv",
  "SEGUIMIENTO de cuentas MATÍAS & MACARENA-Grid view.csv",
  "telefonos-resueltos.json",
];

const LISTING = [...DUMPS, ...NOT_DUMPS];

test("on the whole directory, the window deletes the three September dumps and nothing else", () => {
  assert.deepEqual(backupsToPrune(LISTING, NOW, DEFAULT_BACKUP_RETENTION), [
    "c9de8587-face-4f51-affc-0cee5967a431-2026-09-26T20-11-11-196Z.dump",
    "b9003aae-7c04-43a2-b9d3-df3126a0acc7-2026-09-25T01-17-12-688Z.dump",
    "b9003aae-7c04-43a2-b9d3-df3126a0acc7-2026-09-24T21-02-48-283Z.dump",
  ]);
});

// Checked across several policies, including the most destructive one the type allows, and at a date far
// enough out that every real dump has expired.
test("no file other than a dump is a candidate under any policy, at any date", () => {
  const policies = [
    DEFAULT_BACKUP_RETENTION,
    { days: 1, keepNewest: 0 },
    { days: 0.001, keepNewest: 0 },
    { days: 365, keepNewest: 1 },
  ];
  for (const now of [NOW, FAR_FUTURE]) {
    for (const policy of policies) {
      const pruned = backupsToPrune(LISTING, now, policy);
      for (const name of pruned) assert.ok(DUMPS.includes(name), `${name} is not a dump and must never be deleted`);
      for (const name of NOT_DUMPS) assert.ok(!pruned.includes(name), `${name} must never be deleted`);
    }
  }
  // The most destructive policy at the far date still reaches every dump, so the loop above was not vacuous.
  assert.equal(backupsToPrune(LISTING, FAR_FUTURE, { days: 1, keepNewest: 0 }).length, DUMPS.length);
});

// Shapes designed to slip past a lazier check: a second extension, the timestamp in the middle, a trailing
// space or newline, a unicode digit, an out-of-range date that Date.UTC would happily normalise.
test("a name that is not exactly what backupFileName writes is never a candidate", () => {
  const impostors = [
    "merge-companies-2026-10-01T10-00-00-000Z.dump.csv",
    "merge-companies-2026-10-01T10-00-00-000Z.dump.json",
    "merge-companies-2026-10-01T10-00-00-000Z.dump ",
    "merge-companies-2026-10-01T10-00-00-000Z.dump\n",
    "merge-companies-2026-10-01T10-00-00-000Z.DUMP",
    "merge-companies-2026-13-45T99-99-99Z.dump",
    "merge-companies-0050-10-01T10-00-00Z.dump",
    "merge-companies-٢٠٢٦-10-01T10-00-00Z.dump",
    "copy of merge-companies.dump",
    "2026-10-01T10-00-00-000Z.dump",
    ".dump",
  ];
  assert.deepEqual(backupsToPrune(impostors, FAR_FUTURE, { days: 1, keepNewest: 0 }), []);
  for (const name of impostors) assert.equal(parseBackupFileName(name), null, name);
});

test("the most recent dumps survive their own expiry, so the directory can never empty out", () => {
  const pruned = backupsToPrune(LISTING, FAR_FUTURE, DEFAULT_BACKUP_RETENTION);
  assert.deepEqual(DUMPS.filter((n) => !pruned.includes(n)).sort(), [
    "merge-companies-lot2-rest-2026-10-28T11-52-08-233Z.dump",
    "merge-duplicates-60-2026-10-27T21-48-43Z.dump",
    "merge-duplicates-8-2026-10-28T12-03-08-205Z.dump",
  ]);
});

// The producer/consumer pair: hand-copied fixtures above would keep passing if backupFileName changed its
// format, and the pruner would silently stop matching anything.
test("parseBackupFileName recovers what backupFileName writes", () => {
  for (const runId of ["merge-companies", "merge-companies-galicia-2026-10-09", "b9003aae-7c04-43a2-b9d3-df3126a0acc7"]) {
    const iso = "2026-10-28T12:03:08.205Z";
    const parsed = parseBackupFileName(basename(backupFileName(runId, iso)));
    assert.equal(parsed?.runId, runId);
    assert.equal(parsed?.takenAt.toISOString(), iso);
  }
});

test("parseBackupFileName also reads a timestamp written without milliseconds", () => {
  const noMillis = parseBackupFileName("merge-duplicates-60-2026-10-27T21-48-43Z.dump");
  assert.equal(noMillis?.runId, "merge-duplicates-60");
  assert.equal(noMillis?.takenAt.toISOString(), "2026-10-27T21:48:43.000Z");
});

test("a dump exactly at the edge of the window is kept; one second older goes", () => {
  const policy = { days: 30, keepNewest: 0 };
  const atEdge = "run-2026-09-28T12-30-00-000Z.dump";
  const pastEdge = "run-2026-09-28T12-29-59-000Z.dump";
  assert.deepEqual(backupsToPrune([atEdge], NOW, policy), []);
  assert.deepEqual(backupsToPrune([pastEdge], NOW, policy), [pastEdge]);
});

test("an unusable policy prunes nothing rather than pruning without a floor", () => {
  const old = ["run-2020-01-01T00-00-00-000Z.dump"];
  assert.deepEqual(backupsToPrune(old, NOW, { days: 0, keepNewest: 0 }), []);
  assert.deepEqual(backupsToPrune(old, NOW, { days: -1, keepNewest: 0 }), []);
  assert.deepEqual(backupsToPrune(old, NOW, { days: 30, keepNewest: Number.NaN }), []);
  assert.deepEqual(backupsToPrune(old, NOW, { days: 30, keepNewest: 1.5 }), []);
  assert.deepEqual(backupsToPrune(old, NOW, { days: 30, keepNewest: -1 }), []);
});

test("retentionFromEnv: unset is the default window, and anything unusable keeps every backup", () => {
  assert.deepEqual(retentionFromEnv({}), DEFAULT_BACKUP_RETENTION);
  assert.deepEqual(retentionFromEnv({ BACKUP_RETENTION_DAYS: "  " }), DEFAULT_BACKUP_RETENTION);
  assert.equal(retentionFromEnv({ BACKUP_RETENTION_DAYS: "0" }).days, 0);
  assert.equal(retentionFromEnv({ BACKUP_RETENTION_DAYS: " 90 " }).days, 90);
  // Set but unusable: a typo must not silently fall back to deleting on the default window.
  for (const raw of ["never", "Infinity", "-5", "O", "30 days"]) {
    assert.equal(retentionFromEnv({ BACKUP_RETENTION_DAYS: raw }).days, 0, raw);
  }
  // The floor is not configurable by env.
  assert.equal(retentionFromEnv({ BACKUP_RETENTION_DAYS: "90" }).keepNewest, DEFAULT_BACKUP_RETENTION.keepNewest);
});

test("pruneOldBackups deletes only the expired dump FILES it is pointed at", () => {
  const dir = mkdtempSync(join(tmpdir(), "backup-retention-"));
  try {
    const expired = "old-2026-01-01T00-00-00-000Z.dump";
    const fresh = "new-2026-10-28T00-00-00-000Z.dump";
    const notADump = "inscriptos.csv";
    // A DIRECTORY shaped like an expired dump: it must neither be deleted nor take one of the kept slots.
    const dirShapedLikeADump = "run-2026-01-02T00-00-00-000Z.dump";
    for (const name of [expired, fresh, notADump]) writeFileSync(join(dir, name), "x");
    mkdirSync(join(dir, dirShapedLikeADump));

    const removed = pruneOldBackups(dir, NOW, { days: 30, keepNewest: 0 });
    assert.deepEqual(removed, [expired]);
    assert.deepEqual(readdirSync(dir).sort(), [dirShapedLikeADump, fresh, notADump].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pruneOldBackups on a directory it cannot read deletes nothing and does not throw", () => {
  assert.deepEqual(pruneOldBackups(join(tmpdir(), "backup-retention-does-not-exist"), NOW, DEFAULT_BACKUP_RETENTION), []);
});
