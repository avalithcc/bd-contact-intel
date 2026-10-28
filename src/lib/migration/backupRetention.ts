/**
 * Retention of the pre-execute production dumps in `backups/` (src/lib/migration/backup.ts). Each one is
 * ~8 MB of real production data, PII included, and they only accumulate: nothing deleted them until now.
 *
 * THE DIRECTORY IS NOT ONLY DUMPS. Beside the 12 dumps it holds 19 files and a `contratos/` directory of
 * source data that exists nowhere else — event attendee lists, account spreadsheets, exported CSVs, PDFs, a
 * JSON snapshot. So eligibility is decided by the FILENAME PRODUCED BY `backupFileName`:
 * `<runId>-<iso timestamp>.dump`, on a regular file. Everything else is structurally excluded: a different
 * extension, a second extension after `.dump`, a directory, a symlink.
 *
 * What that does NOT exclude is a hand-made file that happens to carry the same shape — the dump named
 * `before-merge-accenture-argentina-<ts>.dump` in there is subject to this policy like any other, which is
 * right, since it IS a pre-merge dump. Anything in `backups/` that must survive should not be named that way.
 *
 * The age comes from the timestamp IN THE NAME, not from mtime, which a copy or a restore would reset.
 *
 * The policy keeps the most recent `keepNewest` dumps whatever their age, so a long quiet period can never
 * empty the directory, and `days: 0` disables pruning entirely.
 */
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface BackupRetention {
  /** Dumps older than this many days are eligible for deletion. 0 (or less) disables pruning. */
  days: number;
  /** This many of the most recent dumps are kept whatever their age. */
  keepNewest: number;
}

export const DEFAULT_BACKUP_RETENTION: BackupRetention = { days: 30, keepNewest: 3 };

/** Pruning disabled: the shape every "keep everything" answer below returns. */
const KEEP_EVERYTHING: BackupRetention = { ...DEFAULT_BACKUP_RETENTION, days: 0 };

/**
 * `BACKUP_RETENTION_DAYS=0` keeps every dump for ever. An UNSET variable is the default window, but a value
 * that is set and does not parse — a typo, `never`, `Infinity` — disables pruning instead of falling back to
 * it: somebody who went to the trouble of setting it meant to change the policy, and between deleting
 * production dumps and keeping them one more month, keeping them is the failure we can undo.
 */
export function retentionFromEnv(env: Record<string, string | undefined>): BackupRetention {
  const raw = env.BACKUP_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_BACKUP_RETENTION;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 0) {
    console.error(`BACKUP_RETENTION_DAYS=${raw} is not a number of days: keeping every backup instead of pruning.`);
    return KEEP_EVERYTHING;
  }
  return { ...DEFAULT_BACKUP_RETENTION, days };
}

/** The shape `backupFileName` writes: the runId may itself contain dates, so the LAST timestamp wins. */
const BACKUP_FILE = /^(.+)-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,3}))?Z\.dump$/;

export function parseBackupFileName(name: string): { runId: string; takenAt: Date } | null {
  const match = BACKUP_FILE.exec(name);
  if (!match) return null;
  const [, runId, year, month, day, hour, minute, second, millis] = match;
  const takenAt = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), millis ? Number(millis) : 0),
  );
  // Date.UTC NORMALISES out-of-range parts (month 13 becomes January of the next year), which would turn a
  // malformed name into a plausible old date and get the file deleted. Only an exact round trip counts.
  const exact =
    takenAt.getUTCFullYear() === Number(year) &&
    takenAt.getUTCMonth() === Number(month) - 1 &&
    takenAt.getUTCDate() === Number(day) &&
    takenAt.getUTCHours() === Number(hour) &&
    takenAt.getUTCMinutes() === Number(minute) &&
    takenAt.getUTCSeconds() === Number(second);
  return exact ? { runId: runId!, takenAt } : null;
}

/**
 * Pure decision: which of these file names are past retention. Returns names, in the order they would be
 * deleted (oldest last), and never a file whose name does not parse.
 */
export function backupsToPrune(names: readonly string[], now: Date, policy: BackupRetention): string[] {
  if (policy.days <= 0) return [];
  // A non-integer keepNewest would make the slice below behave as slice(0) and delete every eligible dump,
  // so an unusable floor means no pruning at all rather than no floor.
  if (!Number.isInteger(policy.keepNewest) || policy.keepNewest < 0) return [];
  const dated = names
    .map((name) => ({ name, parsed: parseBackupFileName(name) }))
    .filter((entry): entry is { name: string; parsed: { runId: string; takenAt: Date } } => entry.parsed !== null)
    .sort((a, b) => b.parsed.takenAt.getTime() - a.parsed.takenAt.getTime());
  const cutoff = now.getTime() - policy.days * 24 * 60 * 60 * 1000;
  return dated
    .slice(policy.keepNewest)
    .filter((entry) => entry.parsed.takenAt.getTime() < cutoff)
    .map((entry) => entry.name);
}

/**
 * Applies the policy. Called only AFTER a dump has been taken and verified, so the fresh one is both the
 * newest and inside the window; it can never be the file this deletes. A directory it cannot read, or a
 * file it cannot delete, is left alone rather than raised: cleanup must not break the backup.
 */
export function pruneOldBackups(
  directory: string,
  now: Date = new Date(),
  policy: BackupRetention = retentionFromEnv(process.env),
): string[] {
  let names: string[];
  try {
    // Regular files only. A DIRECTORY named like a dump would otherwise take one of the keepNewest slots
    // from a real dump and then fail to delete, costing a backup that should have been kept.
    names = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of backupsToPrune(names, now, policy)) {
    try {
      rmSync(join(directory, name));
      removed.push(name);
    } catch {
      // Keep going: one undeletable file must not stop the rest.
    }
  }
  return removed;
}
